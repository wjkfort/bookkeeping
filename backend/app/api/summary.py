from fastapi import APIRouter, Query, Depends
from sqlalchemy.orm import Session
from typing import Optional
from datetime import date

from app.core.database import get_db
from app.models import Transaction
from app.schemas import SummaryResponse

router = APIRouter()


@router.get("/", response_model=SummaryResponse)
def get_summary(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db)
):
    """Get income/expense summary"""
    query = db.query(Transaction)
    
    if start_date:
        query = query.filter(Transaction.date >= start_date)
    if end_date:
        query = query.filter(Transaction.date <= end_date)
    
    transactions = query.all()
    
    income = sum(float(t.amount) for t in transactions if t.category.type == 'income')
    expense = sum(float(t.amount) for t in transactions if t.category.type == 'expense')
    
    return {
        'income': income,
        'expense': expense,
        'balance': income - expense
    }
