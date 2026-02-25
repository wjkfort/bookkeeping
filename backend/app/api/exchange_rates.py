from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import httpx
from typing import Optional

from app.core.database import get_db
from app.core.config import settings
from app.models import ExchangeRate
from app.schemas import ExchangeRatesResponse

router = APIRouter()


async def fetch_rates_from_api(base: str = "USD") -> dict:
    """Fetch latest exchange rates from Open Exchange Rates API"""
    if not settings.OPEN_EXCHANGE_RATES_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Open Exchange Rates API key not configured"
        )
    
    url = f"https://openexchangerates.org/api/latest.json"
    params = {
        "app_id": settings.OPEN_EXCHANGE_RATES_API_KEY,
        "base": base,
        "symbols": "USD,CNY"  # Only fetch USD and CNY to save bandwidth
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params)
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Failed to fetch exchange rates: {response.text}"
            )
        
        data = response.json()
        return data


def get_cached_rate(db: Session, base: str, target: str) -> Optional[ExchangeRate]:
    """Get cached exchange rate if it's still fresh"""
    cache_expiry = datetime.utcnow() - timedelta(hours=settings.EXCHANGE_RATE_CACHE_HOURS)
    
    rate = db.query(ExchangeRate).filter(
        ExchangeRate.base_currency == base,
        ExchangeRate.target_currency == target,
        ExchangeRate.fetched_at > cache_expiry
    ).order_by(ExchangeRate.fetched_at.desc()).first()
    
    return rate


def save_rates_to_cache(db: Session, base: str, rates: dict):
    """Save exchange rates to database cache"""
    fetched_at = datetime.utcnow()
    
    for currency, rate in rates.items():
        db_rate = ExchangeRate(
            base_currency=base,
            target_currency=currency,
            rate=rate,
            fetched_at=fetched_at
        )
        db.add(db_rate)
    
    db.commit()


@router.get("/rates", response_model=ExchangeRatesResponse)
async def get_exchange_rates(
    base: str = "USD",
    force_refresh: bool = False,
    db: Session = Depends(get_db)
):
    """
    Get exchange rates for USD and CNY.
    Uses cached rates if available and fresh (within 24 hours).
    Set force_refresh=true to fetch fresh rates from API.
    """
    
    # Check cache first unless force refresh
    if not force_refresh:
        # Check if we have both USD and CNY rates cached
        usd_rate = get_cached_rate(db, base, "USD")
        cny_rate = get_cached_rate(db, base, "CNY")
        
        if usd_rate and cny_rate:
            return ExchangeRatesResponse(
                base_currency=base,
                rates={
                    "USD": usd_rate.rate,
                    "CNY": cny_rate.rate
                },
                fetched_at=usd_rate.fetched_at
            )
    
    # Fetch fresh rates from API
    try:
        data = await fetch_rates_from_api(base)
        rates = data.get("rates", {})
        
        # Save to cache
        save_rates_to_cache(db, base, rates)
        
        return ExchangeRatesResponse(
            base_currency=base,
            rates=rates,
            fetched_at=datetime.utcnow()
        )
    except Exception as e:
        # If API fails, try to return stale cache as fallback
        usd_rate = db.query(ExchangeRate).filter(
            ExchangeRate.base_currency == base,
            ExchangeRate.target_currency == "USD"
        ).order_by(ExchangeRate.fetched_at.desc()).first()
        
        cny_rate = db.query(ExchangeRate).filter(
            ExchangeRate.base_currency == base,
            ExchangeRate.target_currency == "CNY"
        ).order_by(ExchangeRate.fetched_at.desc()).first()
        
        if usd_rate and cny_rate:
            return ExchangeRatesResponse(
                base_currency=base,
                rates={
                    "USD": usd_rate.rate,
                    "CNY": cny_rate.rate
                },
                fetched_at=usd_rate.fetched_at
            )
        
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch exchange rates and no cache available: {str(e)}"
        )


@router.get("/convert")
async def convert_currency(
    amount: float,
    from_currency: str,
    to_currency: str,
    db: Session = Depends(get_db)
):
    """
    Convert amount from one currency to another.
    Uses cached rates if available.
    """
    if from_currency == to_currency:
        return {
            "amount": amount,
            "from_currency": from_currency,
            "to_currency": to_currency,
            "converted_amount": amount,
            "rate": 1.0
        }
    
    # Get rate from cache
    rate = get_cached_rate(db, from_currency, to_currency)
    
    if not rate:
        # Try to fetch fresh rates
        try:
            data = await fetch_rates_from_api(from_currency)
            rates = data.get("rates", {})
            save_rates_to_cache(db, from_currency, rates)
            
            if to_currency not in rates:
                raise HTTPException(
                    status_code=404,
                    detail=f"Exchange rate for {to_currency} not found"
                )
            
            rate_value = rates[to_currency]
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to get exchange rate: {str(e)}"
            )
    else:
        rate_value = rate.rate
    
    converted_amount = amount * rate_value
    
    return {
        "amount": amount,
        "from_currency": from_currency,
        "to_currency": to_currency,
        "converted_amount": round(converted_amount, 2),
        "rate": rate_value
    }
