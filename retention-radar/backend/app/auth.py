import hashlib
import hmac
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import JWT_HOURS, JWT_SECRET

bearer = HTTPBearer(auto_error=False)

ROLE_LABELS = {"retention_manager": "Retention Manager", "analyst": "Business Analyst",
               "success_exec": "Customer Success Executive"}


def hash_password(pw: str) -> str:
    salt = hashlib.sha256(b"retention-radar-demo-salt").hexdigest()[:16]
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 120_000)
    return f"pbkdf2${salt}${dk.hex()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, salt, digest = stored.split("$")
    except ValueError:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 120_000).hex()
    return hmac.compare_digest(dk, digest)


def make_token(user: dict) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=JWT_HOURS)
    return jwt.encode({"sub": str(user["id"]), "role": user["role"], "name": user["name"], "exp": exp},
                      JWT_SECRET, algorithm="HS256")


def current_user(cred: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    if cred is None:
        raise HTTPException(401, "Sign in to continue")
    try:
        p = jwt.decode(cred.credentials, JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Your session has expired. Sign in again")
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid session. Sign in again")
    return {"id": int(p["sub"]), "role": p["role"], "name": p["name"]}


def require(*roles):
    def dep(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(403, "Your role does not have access to this action")
        return user
    return dep
