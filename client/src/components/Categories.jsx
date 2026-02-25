import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getCategories, createCategory, deleteCategory } from '../api';

function Categories() {
  const { t } = useTranslation();
  const [categories, setCategories] = useState([]);
  const [formData, setFormData] = useState({ name: '', type: 'expense' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      const response = await getCategories();
      setCategories(response.data);
    } catch (error) {
      console.error('Error loading categories:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createCategory(formData);
      setFormData({ name: '', type: 'expense' });
      loadCategories();
    } catch (error) {
      console.error('Error creating category:', error);
      alert(t('categories.errorCreating'));
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm(t('categories.deleteConfirm'))) {
      try {
        await deleteCategory(id);
        loadCategories();
      } catch (error) {
        console.error('Error deleting category:', error);
        alert(t('categories.errorDeleting'));
      }
    }
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
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
            >
              <option value="income">{t('categories.income')}</option>
              <option value="expense">{t('categories.expense')}</option>
            </select>
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
              {categories.map(category => (
                <tr key={category.id}>
                  <td>{category.name}</td>
                  <td>
                    <span className={`badge badge-${category.type}`}>
                      {t(`categories.${category.type}`)}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => handleDelete(category.id)}
                      className="btn btn-danger"
                    >
                      {t('categories.deleteBtn')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default Categories;
