from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional

from app.core.database import get_db
from app.models import Category
from app.schemas import CategoryCreate, CategoryResponse, CategoryUpdate

router = APIRouter()


@router.get("/", response_model=List[CategoryResponse])
def get_categories(
    flat: bool = Query(False, description="Return flat list instead of hierarchical structure"),
    db: Session = Depends(get_db)
):
    """
    Get all categories.
    - If flat=false (default): Returns hierarchical structure with only top-level categories and their children
    - If flat=true: Returns all categories in a flat list
    """
    if flat:
        # Return all categories in a flat list
        categories = db.query(Category).options(joinedload(Category.children)).all()
        return categories
    else:
        # Return only top-level categories with their children nested
        categories = db.query(Category).filter(Category.parent_id == None).options(joinedload(Category.children)).all()
        return categories


@router.get("/{id}", response_model=CategoryResponse)
def get_category(id: int, db: Session = Depends(get_db)):
    """Get a specific category by ID"""
    category = db.query(Category).filter(Category.id == id).options(joinedload(Category.children)).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return category


@router.post("/", response_model=CategoryResponse, status_code=201)
def create_category(category: CategoryCreate, db: Session = Depends(get_db)):
    """Create a new category (can be top-level or subcategory)"""
    # Validate parent exists if parent_id is provided
    if category.parent_id:
        parent = db.query(Category).filter(Category.id == category.parent_id).first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent category not found")
        # Ensure parent and child have the same type
        if parent.type != category.type:
            raise HTTPException(status_code=400, detail="Subcategory must have the same type as parent")
    
    # Check for duplicate name within the same parent
    existing = db.query(Category).filter(
        Category.name == category.name,
        Category.parent_id == category.parent_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Category with this name already exists in this parent")
    
    db_category = Category(name=category.name, type=category.type, parent_id=category.parent_id)
    db.add(db_category)
    db.commit()
    db.refresh(db_category)
    return db_category


@router.put("/{id}", response_model=CategoryResponse)
def update_category(id: int, category: CategoryUpdate, db: Session = Depends(get_db)):
    """Update a category"""
    db_category = db.query(Category).filter(Category.id == id).first()
    if not db_category:
        raise HTTPException(status_code=404, detail="Category not found")
    
    # Validate parent exists if parent_id is being updated
    if category.parent_id is not None:
        if category.parent_id == id:
            raise HTTPException(status_code=400, detail="Category cannot be its own parent")
        parent = db.query(Category).filter(Category.id == category.parent_id).first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent category not found")
        # Ensure parent and child have the same type
        new_type = category.type if category.type else db_category.type
        if parent.type != new_type:
            raise HTTPException(status_code=400, detail="Subcategory must have the same type as parent")
    
    # Update fields
    if category.name is not None:
        db_category.name = category.name
    if category.type is not None:
        db_category.type = category.type
    if category.parent_id is not None:
        db_category.parent_id = category.parent_id
    
    db.commit()
    db.refresh(db_category)
    return db_category


@router.delete("/{id}", status_code=204)
def delete_category(id: int, db: Session = Depends(get_db)):
    """Delete a category (will cascade delete all subcategories)"""
    category = db.query(Category).filter(Category.id == id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    db.delete(category)
    db.commit()
    return None
