from fastapi import APIRouter, HTTPException, Query, Depends
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, date

from app.core.database import get_db
from app.models import Transaction
from app.schemas import TransactionCreate, TransactionUpdate, TransactionResponse

router = APIRouter()


@router.get("/", response_model=List[TransactionResponse])
def get_transactions(
    category_id: Optional[int] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db)
):
    """Get all transactions with optional filters"""
    query = db.query(Transaction)
    
    if category_id:
        query = query.filter(Transaction.category_id == category_id)
    if start_date:
        query = query.filter(Transaction.date >= start_date)
    if end_date:
        query = query.filter(Transaction.date <= end_date)
    
    transactions = query.order_by(Transaction.date.desc()).all()
    
    # Add category_name to each transaction
    result = []
    for t in transactions:
        transaction_dict = {
            "id": t.id,
            "amount": float(t.amount),
            "description": t.description,
            "date": t.date,
            "category_id": t.category_id,
            "category_name": t.category.name if t.category else None,
            "created_at": t.created_at,
            "updated_at": t.updated_at
        }
        result.append(transaction_dict)
    
    return result


@router.post("/", response_model=TransactionResponse, status_code=201)
def create_transaction(transaction: TransactionCreate, db: Session = Depends(get_db)):
    """Create a new transaction"""
    transaction_date = date.today()
    if transaction.date:
        transaction_date = datetime.fromisoformat(transaction.date).date()
    
    db_transaction = Transaction(
        amount=transaction.amount,
        description=transaction.description or "",
        category_id=transaction.category_id,
        date=transaction_date
    )
    db.add(db_transaction)
    db.commit()
    db.refresh(db_transaction)
    return db_transaction


@router.put("/{id}", response_model=TransactionResponse)
def update_transaction(id: int, transaction: TransactionUpdate, db: Session = Depends(get_db)):
    """Update a transaction"""
    db_transaction = db.query(Transaction).filter(Transaction.id == id).first()
    if not db_transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    if transaction.amount is not None:
        db_transaction.amount = transaction.amount
    if transaction.description is not None:
        db_transaction.description = transaction.description
    if transaction.category_id is not None:
        db_transaction.category_id = transaction.category_id
    if transaction.date is not None:
        db_transaction.date = datetime.fromisoformat(transaction.date).date()
    
    db.commit()
    db.refresh(db_transaction)
    return db_transaction


@router.delete("/{id}", status_code=204)
def delete_transaction(id: int, db: Session = Depends(get_db)):
    """Delete a transaction"""
    transaction = db.query(Transaction).filter(Transaction.id == id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    db.delete(transaction)
    db.commit()
    return None
