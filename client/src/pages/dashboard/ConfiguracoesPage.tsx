import React, { useState } from 'react';
import { 
  Settings2, 
  Globe2, 
  Download, 
  Bell, 
  ChevronDown
} from 'lucide-react';

export const ConfiguracoesPage: React.FC = () => {
  const [theme, setTheme] = useState('Escuro');
  const [language, setLanguage] = useState('Português');
  const [fontSize, setFontSize] = useState('Médio (15px)');
  
  const [coordSystem, setCoordSystem] = useState('UTM / SIRGAS 2000');
  const [areaUnit, setAreaUnit] = useState('Hectares (ha)');
  const [defaultLayer, setDefaultLayer] = useState('CBERS-4A WPM');

  const [exportFormat, setExportFormat] = useState('GeoTIFF (.tif)');
  const [exportMetadata, setExportMetadata] = useState('Sim');
  const [compressFiles, setCompressFiles] = useState('Sim');

  const [notifProcessing, setNotifProcessing] = useState(true);
  const [notifFeatures, setNotifFeatures] = useState(true);
  const [notifFire, setNotifFire] = useState(false);

  const SettingSelect = ({ label, value, onChange }: { label: string, value: string, onChange: () => void }) => (
    <div className="flex items-center justify-between py-2">
      <span className="text-[13px] text-text-secondary">{label}</span>
      <button 
        onClick={onChange}
        className="flex items-center gap-2 px-3 py-1.5 bg-input rounded-md hover:bg-white-alpha-10 transition-colors"
      >
        <span className="text-[12px] text-text-primary">{value}</span>
        <ChevronDown size={14} className="text-text-muted" />
      </button>
    </div>
  );

  const SettingToggle = ({ label, active, onToggle }: { label: string, active: boolean, onToggle: () => void }) => (
    <div className="flex items-center justify-between py-2">
      <span className="text-[13px] text-text-secondary">{label}</span>
      <button 
        onClick={onToggle}
        className={`w-11 h-6 rounded-full p-1 flex items-center transition-colors ${active ? 'bg-green-600 justify-end' : 'bg-input justify-start'}`}
      >
        <div className="w-4 h-4 bg-white rounded-full shadow-sm" />
      </button>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-6 lg:p-10">
      <div className="max-w-4xl mx-auto space-y-6">
        
        <div>
          <h1 className="text-3xl font-bold font-heading text-text-primary mb-2">Configurações</h1>
          <p className="text-sm text-text-secondary">Gerencie suas preferências, dados geoespaciais e configurações de exportação.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
          
          {/* Card Geral */}
          <div className="bg-card rounded-2xl border border-border-subtle p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Settings2 className="text-text-primary" size={20} />
              <h2 className="text-[15px] font-semibold text-text-primary">Geral</h2>
            </div>
            <div className="space-y-2 mt-2">
              <SettingSelect label="Tema" value={theme} onChange={() => {}} />
              <SettingSelect label="Idioma" value={language} onChange={() => {}} />
              <SettingSelect label="Tamanho da fonte" value={fontSize} onChange={() => {}} />
            </div>
          </div>

          {/* Card Dados Geoespaciais */}
          <div className="bg-card rounded-2xl border border-border-subtle p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Globe2 className="text-text-primary" size={20} />
              <h2 className="text-[15px] font-semibold text-text-primary">Dados Geoespaciais</h2>
            </div>
            <div className="space-y-2 mt-2">
              <SettingSelect label="Sistema de coordenadas" value={coordSystem} onChange={() => {}} />
              <SettingSelect label="Unidade de área" value={areaUnit} onChange={() => {}} />
              <SettingSelect label="Camada padrão" value={defaultLayer} onChange={() => {}} />
            </div>
          </div>

          {/* Card Exportação */}
          <div className="bg-card rounded-2xl border border-border-subtle p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Download className="text-text-primary" size={20} />
              <h2 className="text-[15px] font-semibold text-text-primary">Exportação</h2>
            </div>
            <div className="space-y-2 mt-2">
              <SettingSelect label="Formato padrão" value={exportFormat} onChange={() => {}} />
              <SettingSelect label="Incluir metadados" value={exportMetadata} onChange={() => {}} />
              <SettingSelect label="Compactar arquivos grandes" value={compressFiles} onChange={() => {}} />
            </div>
          </div>

          {/* Card Notificações */}
          <div className="bg-card rounded-2xl border border-border-subtle p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Bell className="text-text-primary" size={20} />
              <h2 className="text-[15px] font-semibold text-text-primary">Notificações</h2>
            </div>
            <div className="space-y-2 mt-2">
              <SettingToggle label="Alertas de processamento" active={notifProcessing} onToggle={() => setNotifProcessing(!notifProcessing)} />
              <SettingToggle label="Novas funcionalidades" active={notifFeatures} onToggle={() => setNotifFeatures(!notifFeatures)} />
              <SettingToggle label="Alertas de incêndio" active={notifFire} onToggle={() => setNotifFire(!notifFire)} />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default ConfiguracoesPage;
