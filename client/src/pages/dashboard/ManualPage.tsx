import React from 'react';
import Dashboard from '../Dashboard';

export const ManualPage: React.FC = () => {
  return <Dashboard initialView="features" hideSidebar={true} />;
};

export default ManualPage;
