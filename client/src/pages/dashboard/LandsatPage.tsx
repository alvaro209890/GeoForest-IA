import React from 'react';
import Dashboard from '../Dashboard';

export const LandsatPage: React.FC = () => {
  return <Dashboard initialView="landsat" hideSidebar={true} />;
};

export default LandsatPage;
