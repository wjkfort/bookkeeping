import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getCategories, createCategory, deleteCategory } from '../api';

function Categories() {
  const { t } = useTranslation();
  const [categories, setCategories] = useState([]);
  const [flatCategories, setFlatCategories] = useState([]);
  const [formData, setFormData] = useState({ name: '', type: 'expense', parent_id: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      // Load hierarchical structure for display
      const response = await getCategories();
      setCategories(response.data);
      
      // Load flat list for parent selection dropdown
      const flatResponse = await getCategories(true);
      setFlatCategories(flatResponse.data);
    } catch (error) {
      console.error('Error loading categories:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const dataToSubmit = {
        name: formData.name,
        type: formData.type,
        parent_id: formData.parent_id || null
      };
      await createCategory(dataToSubmit);
      setFormData({ name: '', type: 'expense', parent_id: null });
      loadCategories();
    } catch (error) {
      console.error('Error creating category:', error);
      alert(error.response?.data?.detail || t('categories.errorCreating'));
    }
  };

  const handleDelete = async (id, hasChildren) => {
    const confirmMessage = hasChildren 
      ? t('categories.deleteConfirmWithChildren')
      : t('categories.deleteConfirm');
    
    if (window.confirm(confirmMessage)) {
      try {
        await deleteCategory(id);
        loadCategories();
      } catch (error) {
        console.error('Error deleting category:', error);
        alert(t('categories.errorDeleting'));
      }
    }
  };

  // Get available parent categories based on selected type
  const getAvailableParents = () => {
    return flatCategories.filter(cat => 
      cat.type === formData.type && !cat.parent_id
    );
  };

  // Render category row with indentation for subcategories
  const renderCategoryRow = (category, level = 0) => {
    const hasChildren = category.children && category.children.length > 0;
    const indent = level * 30;
    
    return (
      <React.Fragment key={category.id}>
        <tr>
          <td style={{ paddingLeft: `${indent + 10}px` }}>
            {level > 0 && <span style={{ color: '#999', marginRight: '5px' }}>└─</span>}
            {category.name}
          </td>
          <td>
            <span className={`badge badge-${category.type}`}>
              {t(`categories.${category.type}`)}
            </span>
          </td>
          <td>
            <button
              onClick={() => handleDelete(category.id, hasChildren)}
              className="btn btn-danger"
            >
              {t('categories.deleteBtn')}
            </button>
          </td>
        </tr>
        {hasChildren && category.children.map(child => renderCategoryRow(child, level + 1))}
      </React.Fragment>
    );
  };

  if (loading) return <div>{t('categories.loading')}</div>;

  return (
    <div>
      <h1>{t('categories.title')}</h1>

      <div className="card">
        <h2>{t('categories.addNew')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t('categories.name')}</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="form-group">
            <label>{t('categories.type')}</label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value, parent_id: null })}
            >
              <option value="income">{t('categories.income')}</option>
              <option value="expense">{t('categories.expense')}</option>
            </select>
          </div>

          <div className="form-group">
            <label>{t('categories.parentCategory')}</label>
            <select
              value={formData.parent_id || ''}
              onChange={(e) => setFormData({ ...formData, parent_id: e.target.value || null })}
            >
              <option value="">{t('categories.noParent')}</option>
              {getAvailableParents().map(cat => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
            <small style={{ color: '#666', display: 'block', marginTop: '5px' }}>
              {t('categories.parentHint')}
            </small>
          </div>

          <button type="submit" className="btn btn-primary">{t('categories.add')}</button>
        </form>
      </div>

      <div className="card">
        <h2>{t('categories.allCategories')}</h2>
        {categories.length === 0 ? (
          <p>{t('categories.noCategories')}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('categories.name')}</th>
                <th>{t('categories.type')}</th>
                <th>{t('categories.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {categories.map(category => renderCategoryRow(category))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default Categories;
