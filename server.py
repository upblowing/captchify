
import os
import time
import secrets
import hmac
import hashlib
from typing import Dict, Any, Optional

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import jwt as pyjwt

APP_SECRET = os.environ.get("APP_SECRET", secrets.token_hex(32))
JWT_SECRET = os.environ.get("JWT_SECRET", APP_SECRET)
JWT_ALG = "HS256"

CHALLENGES: Dict[str, Dict[str, Any]] = {}
RATE: Dict[str, Dict[str, Any]] = {}

POW_DIFFICULTY = 18
CHALLENGE_TTL = 180
TOKEN_TTL = 300

app = FastAPI(title="captchify")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")

class InitResponse(BaseModel):
    challenge_id: str
    prefix: str
    difficulty: int
    expires_in: int

class Features(BaseModel):
    move_count: int = 0
    path_length: float = 0.0
    avg_speed: float = 0.0
    max_speed: float = 0.0
    dir_entropy: float = 0.0
    jitter_ratio: float = 0.0
    idle_events: int = 0
    scroll_events: int = 0
    key_events: int = 0
    key_interval_entropy: float = 0.0
    focus_changes: int = 0
    window_blurs: int = 0
    touch_events: int = 0
    move_interval_entropy: float = 0.0
    straightness_score: float = 0.0
    acceleration_variance: float = 0.0

class VerifyRequest(BaseModel):
    challenge_id: str
    client_nonce: str
    features: Features
    puzzle_ok: bool = False

class VerifyResponse(BaseModel):
    ok: bool
    token: Optional[str] = None
    risk: float = 1.0
    reason: Optional[str] = None

def leading_zero_bits(h: bytes) -> int:
    zero_bits = 0
    for b in h:
        if b == 0:
            zero_bits += 8
            continue
        for i in range(7, -1, -1):
            if (b >> i) & 1 == 0:
                zero_bits += 1
            else:
                return zero_bits
        return zero_bits
    return zero_bits

def make_prefix(challenge_id: str, srv_nonce: str) -> str:
    mac = hmac.new(APP_SECRET.encode(), f"{challenge_id}:{srv_nonce}".encode(), hashlib.sha256).digest()
    return mac[:16].hex()

def ip_addr(req: Request) -> str:
    return req.headers.get("x-forwarded-for", req.client.host if req.client else "0.0.0.0")

def rate_limit(ip: str) -> None:
    w = RATE.setdefault(ip, {"t": 0.0, "c": 0})
    now = time.time()
    if now - w["t"] > 10:
        w["t"] = now
        w["c"] = 0
    w["c"] += 1
    if w["c"] > 50:
        raise HTTPException(status_code=429, detail="too many requests")

@app.get("/", response_class=HTMLResponse)
def root():
    with open(os.path.join(os.path.dirname(__file__), "static", "index.html"), "r", encoding="utf-8") as f:
        return f.read()

def is_bot(req: Request) -> bool:
    user_agent = req.headers.get("user-agent", "").lower()
    
    ids = [
        "wget", "curl", "python", "requests", "selenium", "chromedriver", "phantomjs",
        "headless", "puppet", "bot", "crawl", "spider", "scripted", "automated"
    ]
    
    if any(identifier in user_agent for identifier in ids):
        return True
        
    required_headers = ["accept", "accept-language", "accept-encoding"]
    if not all(header in req.headers for header in required_headers):
        return True
        
    return False

@app.get("/captcha/init", response_model=InitResponse)
def captcha_init(req: Request):
    ip = ip_addr(req)
    rate_limit(ip)
    
    if is_bot(req):
        raise HTTPException(status_code=403, detail="bots are not allowed")

    challenge_id = secrets.token_urlsafe(16)
    srv_nonce = secrets.token_urlsafe(16)
    prefix = make_prefix(challenge_id, srv_nonce)
    issued_at = int(time.time())
    CHALLENGES[challenge_id] = {
        "srv_nonce": srv_nonce,
        "prefix": prefix,
        "difficulty": POW_DIFFICULTY,
        "iat": issued_at,
        "used": False,
        "ip": ip,
    }
    return InitResponse(
        challenge_id=challenge_id,
        prefix=prefix,
        difficulty=POW_DIFFICULTY,
        expires_in=CHALLENGE_TTL
    )

@app.post("/captcha/verify", response_model=VerifyResponse)
async def captcha_verify(req: Request, body: VerifyRequest):
    ip = ip_addr(req)
    rate_limit(ip)

    c = CHALLENGES.get(body.challenge_id)
    if not c:
        raise HTTPException(status_code=400, detail="unkown challange id")
    if c["used"]:
        raise HTTPException(status_code=400, detail="challange id already solved/used")
    if int(time.time()) - c["iat"] > CHALLENGE_TTL:
        raise HTTPException(status_code=400, detail="challange expired")

    s = bytes.fromhex(c["prefix"]) + body.client_nonce.encode()
    h = hashlib.sha256(s).digest()
    lz = leading_zero_bits(h)
    if lz < c["difficulty"]:
        return VerifyResponse(ok=False, risk=1.0, reason=f"insufficient PoW: {lz} < {c['difficulty']}")

    f = body.features
    score = 0.0
    reasons = []

    if f.move_count < 20:
        score += 0.25; reasons.append("low move_count")
    if f.path_length < 200:
        score += 0.2; reasons.append("short path")
    if f.avg_speed <= 0 or f.max_speed <= 0:
        score += 0.2; reasons.append("no speed")
    if f.dir_entropy < 1.5: 
        score += 0.15; reasons.append("low dir_entropy")
    if f.jitter_ratio < 0.02:
        score += 0.1; reasons.append("low micro-jitter")
    if f.key_events > 0 and f.key_interval_entropy < 1.0:
        score += 0.1; reasons.append("low key timing entropy")
    if f.touch_events == 0 and f.scroll_events == 0 and f.key_events == 0 and f.move_count < 40:
        score += 0.1; reasons.append("very few interactions")
    if f.move_interval_entropy < 1.2:
        score += 0.2; reasons.append("suspiciously uniform timing")
    if f.straightness_score > 0.95:
        score += 0.2; reasons.append("suspiciously straight movements")
    if f.acceleration_variance < 0.01:
        score += 0.15; reasons.append("unnaturally uniform acceleration")

    if f.focus_changes >= 1:
        score -= 0.05
    if f.window_blurs >= 1:
        score -= 0.03

    score = max(0.0, min(1.0, score))

    allow_threshold = 0.35
    if score <= allow_threshold or body.puzzle_ok:
        c["used"] = True
        now = int(time.time())
        token = pyjwt.encode(
            {"cid": body.challenge_id, "iat": now, "exp": now + TOKEN_TTL, "ip": ip},
            JWT_SECRET, algorithm=JWT_ALG
        )
        return VerifyResponse(ok=True, token=token, risk=score)

    return VerifyResponse(ok=False, risk=score, reason="couldnt verify, solve puzzle")


