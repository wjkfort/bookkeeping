from fastapi import APIRouter, Query, Depends
from sqlalchemy.orm import Session
from typing import Optional
from datetime import date, datetime, timedelta

from app.core.database import get_db
from app.models import Transaction, ExchangeRate
from app.schemas import SummaryResponse

router = APIRouter()


def get_exchange_rate(db: Session, from_currency: str, to_currency: str = 'USD') -> float:
    """Get cached exchange rate, return 1.0 if same currency or not found"""
    if from_currency == to_currency:
        return 1.0
    
    # Get most recent rate within last 48 hours
    cache_expiry = datetime.utcnow() - timedelta(hours=48)
    rate = db.query(ExchangeRate).filter(
        ExchangeRate.base_currency == 'USD',
        ExchangeRate.target_currency == from_currency,
        ExchangeRate.fetched_at > cache_expiry
    ).order_by(ExchangeRate.fetched_at.desc()).first()
    
    if rate:
        # Convert from source currency to USD
        return 1.0 / rate.rate
    
    return 1.0  # Fallback if no rate found


@router.get("/", response_model=SummaryResponse)
def get_summary(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    target_currency: str = Query('USD', description='Currency to convert summary to'),
    db: Session = Depends(get_db)
):
    """Get income/expense summary, converted to target currency"""
    query = db.query(Transaction)
    
    if start_date:
        query = query.filter(Transaction.date >= start_date)
    if end_date:
        query = query.filter(Transaction.date <= end_date)
    
    transactions = query.all()
    
    income = 0.0
    expense = 0.0
    
    for t in transactions:
        # Convert amount to target currency
        amount_in_usd = float(t.amount) * get_exchange_rate(db, t.currency, 'USD')
        
        # Then convert from USD to target currency if needed
        if target_currency != 'USD':
            target_rate = db.query(ExchangeRate).filter(
                ExchangeRate.base_currency == 'USD',
                ExchangeRate.target_currency == target_currency
            ).order_by(ExchangeRate.fetched_at.desc()).first()
            
            if target_rate:
                amount_in_target = amount_in_usd * target_rate.rate
            else:
                amount_in_target = amount_in_usd
        else:
            amount_in_target = amount_in_usd
        
        if t.category.type == 'income':
            income += amount_in_target
        else:
            expense += amount_in_target
    
    return {
        'income': income,
        'expense': expense,
        'balance': income - expense
    }
