# captchify
Modern, secure captcha system.
<img src="https://github.com/upblowing/captchify/blob/main/assets/captchify.png?raw=true"></img>

-# note; if you want to use it for ur own projects id recommend obfuscating the js in case someone tries to make a bypass for the captcha

WARNING:
THIS IS NOT PLUG AND PLAY, THIS CAN BE EASILY BYPASSED BY MODIFING REQUESTS, THIS IS JUST POW AND TREAT IS AS A BASE.

-----------------
http://127.0.0.1:8000/captcha/init - initialization of captcha
```json
{
"challenge_id":"-85avzbzCvXSZ_m1zA3CmA",
"prefix":"fb48647003aef97b60ece34aef29b29f",
"difficulty":18,
"expires_in":180
}
```

http://127.0.0.1:8000/captcha/verify - verification of captcha

the javascript analyzes ur mouse movements, behaviour, mouse speed, scrolling and everything to make it as secure as possible
```json
{
  "challenge_id": "-85avzbzCvXSZ_m1zA3CmA",
  "client_nonce": "1242407",
  "features": {
    "move_count": 255,
    "path_length": 5991,
    "avg_speed": 1.76018821482392,
    "max_speed": 11.095544651395493,
    "dir_entropy": 3.3161275388867884,
    "jitter_ratio": 0.09803921568627451,
    "idle_events": 6,
    "scroll_events": 0,
    "key_events": 0,
    "key_interval_entropy": 0,
    "focus_changes": 2,
    "window_blurs": 2,
    "touch_events": 0
  },
  "puzzle_ok": false
}
```

response:
```json
{
  "ok": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjaWQiOiItODVhdnpiekN2WFNaX20xekEzQ21BIiwiaWF0IjoxNzU2MTIwOTczLCJleHAiOjE3NTYxMjEyNzMsImlwIjoiMTI3LjAuMC4xIn0.Nq_YJce-iuy0BEccbI5Za6wlv2Yh3Mtg5R3V5kxFvXE",
  "risk": 0.0,
  "reason": null
}
```
