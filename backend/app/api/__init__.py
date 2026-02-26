from fastapi import APIRouter
from app.api import categories, transactions, summary, exchange_rates, translate

api_router = APIRouter()

api_router.include_router(categories.router, prefix="/categories", tags=["categories"])
api_router.include_router(transactions.router, prefix="/transactions", tags=["transactions"])
api_router.include_router(summary.router, prefix="/summary", tags=["summary"])
api_router.include_router(exchange_rates.router, prefix="/exchange-rates", tags=["exchange-rates"])
api_router.include_router(translate.router, prefix="/translate", tags=["translate"])
