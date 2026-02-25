from fastapi import APIRouter
from app.api import categories, transactions, summary

api_router = APIRouter()

api_router.include_router(categories.router, prefix="/categories", tags=["categories"])
api_router.include_router(transactions.router, prefix="/transactions", tags=["transactions"])
api_router.include_router(summary.router, prefix="/summary", tags=["summary"])
