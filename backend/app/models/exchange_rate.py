from sqlalchemy import Column, Integer, String, Float, DateTime
from datetime import datetime
from app.core.database import Base


class ExchangeRate(Base):
    __tablename__ = 'exchange_rates'
    
    id = Column(Integer, primary_key=True, index=True)
    base_currency = Column(String(3), nullable=False, default='USD')
    target_currency = Column(String(3), nullable=False, index=True)
    rate = Column(Float, nullable=False)
    fetched_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    # Composite unique constraint to ensure one rate per currency pair per fetch
    __table_args__ = (
        {'comment': 'Stores cached exchange rates from Open Exchange Rates API'}
    )
