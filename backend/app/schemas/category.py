from pydantic import BaseModel
from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict


class CategoryType(str, Enum):
    income = "income"
    expense = "expense"


class CategoryCreate(BaseModel):
    name: str
    type: CategoryType
    parent_id: Optional[int] = None
    translations: Optional[Dict[str, str]] = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[CategoryType] = None
    parent_id: Optional[int] = None
    translations: Optional[Dict[str, str]] = None


class CategoryResponse(BaseModel):
    id: int
    name: str
    type: str
    parent_id: Optional[int] = None
    translations: Optional[Dict[str, str]] = None
    created_at: datetime
    children: Optional[List['CategoryResponse']] = []

    class Config:
        from_attributes = True


# Enable forward references for recursive model
CategoryResponse.model_rebuild()
