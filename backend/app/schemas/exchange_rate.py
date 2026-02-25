from pydantic import BaseModel
from datetime import datetime


class ExchangeRateResponse(BaseModel):
    base_currency: str
    target_currency: str
    rate: float
    fetched_at: datetime

    class Config:
        from_attributes = True


class ExchangeRatesResponse(BaseModel):
    base_currency: str
    rates: dict[str, float]
    fetched_at: datetime
