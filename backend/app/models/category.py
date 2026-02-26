from sqlalchemy import Column, Integer, String, Numeric, Text, Date, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base


class Category(Base):
    __tablename__ = 'categories'
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    type = Column(String(20), nullable=False)  # 'income' or 'expense'
    parent_id = Column(Integer, ForeignKey('categories.id', ondelete='CASCADE'), nullable=True)
    translations = Column(JSON, nullable=True)  # {"en": "Food", "zh": "食物"}
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Self-referential relationship for hierarchical structure
    parent = relationship('Category', remote_side=[id], back_populates='children')
    children = relationship('Category', back_populates='parent', cascade='all, delete-orphan')
    
    transactions = relationship('Transaction', back_populates='category')
