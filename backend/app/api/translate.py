from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from googletrans import Translator

router = APIRouter()
translator = Translator()


class TranslateRequest(BaseModel):
    text: str
    from_lang: str
    to_lang: str


class TranslateResponse(BaseModel):
    text: str


@router.post("/", response_model=TranslateResponse)
async def translate_text(request: TranslateRequest):
    """Translate text using Google Translate API"""
    try:
        # Map 'zh' to 'zh-cn' for googletrans compatibility
        from_lang = 'zh-cn' if request.from_lang == 'zh' else request.from_lang
        to_lang = 'zh-cn' if request.to_lang == 'zh' else request.to_lang
        
        result = translator.translate(request.text, src=from_lang, dest=to_lang)
        return TranslateResponse(text=result.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Translation error: {str(e)}")
