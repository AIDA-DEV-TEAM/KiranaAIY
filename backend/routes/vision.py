import os
import google.generativeai as genai
from fastapi import APIRouter, UploadFile, File, HTTPException
from PIL import Image
import io
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/vision", tags=["vision"])

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    print("Warning: GEMINI_API_KEY not found in environment variables")
else:
    genai.configure(api_key=api_key)

model = genai.GenerativeModel('gemini-2.5-flash')

@router.post("/ocr")
async def process_bill(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        
        prompt = """
        Analyze this image.
        First, determine if this image is a Document (such as a Bill of Lading, Invoice, Receipt, or Shopping List).
        
        CRITICAL RULE:
        - If the image is a picture of a Store Shelf, Products on a Rack, a Person, or a general scene, YOU MUST RETURN AN ERROR.
        - Return strictly this JSON object for invalid images: {"error": "This looks like a photo of a shelf or products. Please upload a clear image of a Bill or Invoice document."}

        If and ONLY IF the image IS a valid document/bill:
        Extract the list of items and their quantities. DO NOT EXTRACT PRICES.
        Return the data in a pure JSON format like this:
        [
            {"name": "Item Name", "quantity": 10},
            ...
        ]
        
        Do not include any markdown formatting (like ```json), explanation, or other text. Just the JSON.
        """
        
        response = model.generate_content([prompt, image])
        return {"data": response.text.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR failed: {str(e)}")

@router.post("/shelf")
async def analyze_shelf(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        
        prompt = """
        You are an Expert Retail Inventory Manager. 
        Analyze the provided image.
        
        CRITICAL VALIDATION STEP:
        - First, check if this is a valid Retail Shelf image containing products.
        - If the image is a Document (Bill, Invoice, Text List), a Person, or unrelated scene, YOU MUST RETURN AN ERROR.
        - Return strictly this JSON object for invalid images: {"error": "This looks like a document or unrelated image. Please upload a photo of a Store Shelf with products."}

        If and ONLY IF it is a valid Shelf image:
        Extract the product information into a structured JSON array.
        
        The JSON objects must have the following fields:
        - "name": Identify the product name or type visible on the label or packaging. Be as specific as possible.
        - "shelf": Identify the shelf number or location code if visible. If not explicitly visible, assign a logical identifier (e.g., "Top Shelf", "Middle Shelf", "Rack 1").

        Exception Handling:
        - If the image is very blurry, too dark, or the product details are not legible, return {"error": "The image is too blurry or dark. Please upload a clearer photo of the shelf."}
        - If only few products labels are not legible, output the JSON for the products that are legible.

        Return the data in a STRICT JSON array format. Do not include any markdown formatting (like ```json ... ```), explanations, or extra text.
        """
        
        response = model.generate_content([prompt, image])
        return {"data": response.text.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Shelf analysis failed: {str(e)}")
