import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings

# Load .env file from backend directory
env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(dotenv_path=env_path)


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "YOUR_DATABASE_URL_HERE")

    # Open Exchange Rates API
    OPEN_EXCHANGE_RATES_API_KEY: str = os.getenv("OPEN_EXCHANGE_RATES_API_KEY", "")
    EXCHANGE_RATE_CACHE_HOURS: int = 24  # Cache rates for 24 hours

    # API
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "Bookkeeping API"

    # CORS
    BACKEND_CORS_ORIGINS: list = ["http://localhost:5174"]

    class Config:
        case_sensitive = True


settings = Settings()
