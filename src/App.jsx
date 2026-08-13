import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import GrowthLayout from './components/GrowthLayout';
import GrowthDashboard from './pages/GrowthDashboard';

function App() {
  return (
    <BrowserRouter basename="/">
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<GrowthLayout><GrowthDashboard /></GrowthLayout>} />
        <Route path="*" element={<div>Growth OS — Not Found</div>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
