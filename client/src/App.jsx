import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Dashboard from './components/Dashboard';
import Transactions from './components/Transactions';
import Categories from './components/Categories';
import LanguageSwitcher from './components/LanguageSwitcher';
import './i18n';
import './App.css';

function App() {
  const { t } = useTranslation();

  return (
    <Router>
      <div className="App">
        <nav className="navbar">
          <h1>{t('nav.title')}</h1>
          <div className="nav-links">
            <Link to="/">{t('nav.dashboard')}</Link>
            <Link to="/transactions">{t('nav.transactions')}</Link>
            <Link to="/categories">{t('nav.categories')}</Link>
          </div>
          <LanguageSwitcher />
        </nav>
        
        <div className="container">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/categories" element={<Categories />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
