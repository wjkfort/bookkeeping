from pydantic import BaseModel, Field
from datetime import date, datetime
from typing import Optional


class TransactionCreate(BaseModel):
    amount: float = Field(..., gt=0)
    currency: str = Field(default='USD', max_length=3)
    description: Optional[str] = None
    category_id: int
    date: Optional[str] = None  # Accept string date in ISO format


class TransactionUpdate(BaseModel):
    amount: Optional[float] = Field(None, gt=0)
    currency: Optional[str] = Field(None, max_length=3)
    description: Optional[str] = None
    category_id: Optional[int] = None
    date: Optional[str] = None  # Accept string date in ISO format


class TransactionResponse(BaseModel):
    id: int
    amount: float
    currency: str
    description: Optional[str]
    date: date
    category_id: int
    category_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
