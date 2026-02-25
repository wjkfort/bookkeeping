from pydantic import BaseModel


class SummaryResponse(BaseModel):
    income: float
    expense: float
    balance: float
