import React from 'react';

interface ProjectDetailPageProps {
  id: string;
}

export const ProjectDetailPage: React.FC<ProjectDetailPageProps> = ({ id }) => {
  return (
    <div className="p-8 h-full">
      <h1 className="text-2xl font-bold mb-4">Detalhes do Projeto</h1>
      <p className="text-text-secondary">Visualizando projeto ID: {id}</p>
    </div>
  );
};

export default ProjectDetailPage;
