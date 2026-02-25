from pydantic import BaseModel
from datetime import datetime
from enum import Enum


class CategoryType(str, Enum):
    income = "income"
    expense = "expense"


class CategoryCreate(BaseModel):
    name: str
    type: CategoryType


class CategoryResponse(BaseModel):
    id: int
    name: str
    type: str
    created_at: datetime

    class Config:
        from_attributes = True
