/**
 * Hook de estado da análise de Erros (Vértices Próximas / Containment / Geometry) do Dashboard.
 * Plano 03, passo 8 — extrai estado puro de Dashboard.tsx.
 *
 * Padrão: retorna estado + setters + refs + resetVerticesDraft. Os callbacks
 * pesados (handleVerticesUpload, handleContainmentUpload, handleGeometryUpload)
 * permanecem no Dashboard e consomem os setters deste hook.
 */
import { useCallback, useRef, useState } from 'react';
import type {
  VerticesLayer,
  VerticesProgress,
  VerticesResultRow,
  VerticesHistoryItem,
  ContainmentHistoryItem,
  GeometryHistoryItem,
} from '@/dashboard/types/history';

export function useErrorsAnalysis() {
  // ─── Vértices Próximas State ───
  const [verticesFile, setVerticesFile] = useState<File | null>(null);
  const [verticesUploadId, setVerticesUploadId] = useState<string | null>(null);
  const [verticesLayers, setVerticesLayers] = useState<VerticesLayer[]>([]);
  const [verticesUploading, setVerticesUploading] = useState(false);
  const [verticesProcessing, setVerticesProcessing] = useState(false);
  const [verticesJobId, setVerticesJobId] = useState<string | null>(null);
  const [verticesProgress, setVerticesProgress] = useState<VerticesProgress | null>(null);
  const [verticesWarnings, setVerticesWarnings] = useState<string[]>([]);
  const [verticesError, setVerticesError] = useState<string | null>(null);
  const [verticesRows, setVerticesRows] = useState<VerticesResultRow[]>([]);
  const [verticesDownloadUrl, setVerticesDownloadUrl] = useState<string | null>(null);
  const [verticesHistory, setVerticesHistory] = useState<VerticesHistoryItem[]>([]);
  const [containmentHistory, setContainmentHistory] = useState<ContainmentHistoryItem[]>([]);
  const [containmentJobId, setContainmentJobId] = useState<string | null>(null);
  const [geometryHistory, setGeometryHistory] = useState<GeometryHistoryItem[]>([]);
  const [geometryJobId, setGeometryJobId] = useState<string | null>(null);
  const [verticesIncludeOriginals, setVerticesIncludeOriginals] = useState(true);
  const [verticesIncludeReport, setVerticesIncludeReport] = useState(true);
  const [verticesIncludeCsv, setVerticesIncludeCsv] = useState(true);
  const [verticesPreserveCrs, setVerticesPreserveCrs] = useState(true);
  const [verticesMetricTemporary, setVerticesMetricTemporary] = useState(true);
  const verticesFileInputRef = useRef<HTMLInputElement | null>(null);
  const verticesEventsAbortRef = useRef<AbortController | null>(null);
  const verticesConversationSavedRef = useRef<Set<string>>(new Set());

  const resetVerticesDraft = useCallback(() => {
    verticesEventsAbortRef.current?.abort();
    verticesEventsAbortRef.current = null;
    setVerticesFile(null);
    setVerticesUploadId(null);
    setVerticesLayers([]);
    setVerticesUploading(false);
    setVerticesProcessing(false);
    setVerticesJobId(null);
    setVerticesProgress(null);
    setVerticesWarnings([]);
    setVerticesError(null);
    setVerticesRows([]);
    setVerticesDownloadUrl(null);
    setVerticesIncludeOriginals(true);
    setVerticesIncludeReport(true);
    setVerticesIncludeCsv(true);
    setVerticesPreserveCrs(true);
    setVerticesMetricTemporary(true);
    if (verticesFileInputRef.current) verticesFileInputRef.current.value = '';
  }, []);

  return {
    // estado
    verticesFile,
    verticesUploadId,
    verticesLayers,
    verticesUploading,
    verticesProcessing,
    verticesJobId,
    verticesProgress,
    verticesWarnings,
    verticesError,
    verticesRows,
    verticesDownloadUrl,
    verticesHistory,
    containmentHistory,
    containmentJobId,
    geometryHistory,
    geometryJobId,
    verticesIncludeOriginals,
    verticesIncludeReport,
    verticesIncludeCsv,
    verticesPreserveCrs,
    verticesMetricTemporary,
    // refs
    verticesFileInputRef,
    verticesEventsAbortRef,
    verticesConversationSavedRef,
    // setters
    setVerticesFile,
    setVerticesUploadId,
    setVerticesLayers,
    setVerticesUploading,
    setVerticesProcessing,
    setVerticesJobId,
    setVerticesProgress,
    setVerticesWarnings,
    setVerticesError,
    setVerticesRows,
    setVerticesDownloadUrl,
    setVerticesHistory,
    setContainmentHistory,
    setContainmentJobId,
    setGeometryHistory,
    setGeometryJobId,
    setVerticesIncludeOriginals,
    setVerticesIncludeReport,
    setVerticesIncludeCsv,
    setVerticesPreserveCrs,
    setVerticesMetricTemporary,
    // ações
    resetVerticesDraft,
  };
}
