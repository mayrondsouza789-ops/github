from sqlalchemy import create_engine
from .config import DATABASE_URL, ON_VERCEL

engine = create_engine(DATABASE_URL, pool_size=1 if ON_VERCEL else 8, max_overflow=2 if ON_VERCEL else 8, pool_pre_ping=True, future=True)
