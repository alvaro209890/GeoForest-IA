/**
 * Ações do recorte SIMCAR (clip) do Dashboard GeoForest.
 * Plano 03, passo 9 — extraídas de Dashboard.tsx com deps injetadas
 * (padrão useCroquiJobs). São callbacks coesos que operam sobre o estado
 * do clip e a persistência em users/<uid>/simcar_clips.
 */
import { useCallback } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, doc, getDocs, orderBy, query, serverTimestamp, setDoc } from '@/lib/localFirestore';
import { stripUndefinedDeep } from '../lib/format';
import type { SimcarClipHistoryItem } from '@/dashboard/types/history';

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

export type UseSimcarClipActionsDeps = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  simcarClipsRef: ReturnType<typeof collection> | null;
  userProfileUid?: string;
  setSimcarClipHistory: SetState<SimcarClipHistoryItem[]>;
};

export function useSimcarClipActions({
  apiFetch,
  simcarClipsRef,
  userProfileUid,
  setSimcarClipHistory,
}: UseSimcarClipActionsDeps) {
  const requestProcessCancel = useCallback(
    async (jobId: string | null | undefined) => {
      const normalizedJobId = String(jobId || '').trim();
      if (!normalizedJobId) return false;
      try {
        const response = await apiFetch('/api/process/cancel', {
          method: 'POST',
          body: JSON.stringify({ jobId: normalizedJobId }),
        });
        if (!response.ok) return false;
        return true;
      } catch {
        return false;
      }
    },
    [apiFetch]
  );

  const cancelProcessingJobsForCard = useCallback(
    async (args: {
      cardJobId: string;
      flow: 'simcar';
      extraJobIds?: Array<string | null | undefined>;
    }) => {
      const cardJobId = String(args.cardJobId || '').trim();
      if (!cardJobId) return false;

      const idsToCancel = new Set<string>();
      idsToCancel.add(cardJobId);
      for (const extra of args.extraJobIds || []) {
        const normalized = String(extra || '').trim();
        if (normalized) idsToCancel.add(normalized);
      }

      try {
        const uid = String(auth.currentUser?.uid || userProfileUid || '').trim();
        if (uid) {
          const jobsRef = collection(db, 'users', uid, 'processing_jobs');
          const jobsSnap = await getDocs(query(jobsRef, orderBy('updatedAtMs', 'desc')));
          jobsSnap.forEach((docSnap) => {
            const data = docSnap.data() as any;
            const status = String(data?.status || '').trim().toLowerCase();
            if (status !== 'running' && status !== 'cancel_requested') return;

            const endpoint = String(data?.endpoint || '').trim().toLowerCase();
            const clipJobId = String(data?.metadata?.clipJobId || '').trim();
            const sameDoc = String(docSnap.id || '').trim() === cardJobId;

            if (args.flow === 'simcar') {
              const isSimcarEndpoint = endpoint.startsWith('/api/simcar/clip');
              if (!isSimcarEndpoint) return;
              if (sameDoc || clipJobId === cardJobId) idsToCancel.add(String(docSnap.id));
              return;
            }
          });
        }
      } catch (error) {
        console.warn('Falha ao mapear jobs para cancelamento por card:', error);
      }

      let cancelledAny = false;
      const orderedIds = [...idsToCancel.values()];
      for (const processJobId of orderedIds) {
        const ok = await requestProcessCancel(processJobId);
        if (ok) cancelledAny = true;
      }
      return cancelledAny;
    },
    [requestProcessCancel, userProfileUid]
  );

  const persistSimcarClipHistoryEntry = useCallback(
    async (clip: SimcarClipHistoryItem) => {
      if (!simcarClipsRef) return;
      const clipDocRef = doc(simcarClipsRef, clip.jobId);
      const cleanClip = stripUndefinedDeep(clip);
      const lastMessage = cleanClip.analysisMessages?.[cleanClip.analysisMessages.length - 1];
      const payload = stripUndefinedDeep({
        ...cleanClip,
        kind: 'simcar_recorte',
        title: cleanClip.filename,
        files: {
          inputZipUrl: cleanClip.inputZipUrl,
          outputZipUrl: cleanClip.outputZipUrl,
          contextUrl: cleanClip.contextUrl,
          reportPdfUrl: cleanClip.reportPdfUrl,
          reportPdfDownloadUrl: cleanClip.reportPdfDownloadUrl,
        },
        analysisMessageCount: cleanClip.analysisMessages?.length ?? 0,
        analysisImageCount: cleanClip.analysisImages?.length ?? 0,
        lastMessagePreview: lastMessage?.text ? String(lastMessage.text).slice(0, 280) : '',
      });
      await setDoc(
        clipDocRef,
        {
          ...payload,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    },
    [simcarClipsRef]
  );

  const markSimcarClipStatus = useCallback(
    (jobId: string, status: NonNullable<SimcarClipHistoryItem['status']>, error?: string) => {
      const safeJobId = String(jobId || '').trim();
      if (!safeJobId) return;
      let patchedClip: SimcarClipHistoryItem | null = null;
      setSimcarClipHistory((prev) =>
        prev.map((clip) => {
          if (clip.jobId !== safeJobId) return clip;
          patchedClip = {
            ...clip,
            status,
            error: error ? String(error) : undefined,
          };
          return patchedClip;
        })
      );
      if (patchedClip) {
        void persistSimcarClipHistoryEntry(patchedClip).catch((persistErr) => {
          console.warn('Falha ao atualizar status do card SIMCAR:', persistErr);
        });
      }
    },
    [persistSimcarClipHistoryEntry, setSimcarClipHistory]
  );

  const patchPersistedSimcarClip = useCallback(
    async (jobId: string, patch: Partial<SimcarClipHistoryItem>) => {
      if (!simcarClipsRef || !jobId) return;
      const clipDocRef = doc(simcarClipsRef, jobId);
      const cleanPatch = stripUndefinedDeep(patch);
      const lastMessage =
        Array.isArray(cleanPatch.analysisMessages) && cleanPatch.analysisMessages.length > 0
          ? cleanPatch.analysisMessages[cleanPatch.analysisMessages.length - 1]
          : undefined;
      const enrichedPatch = stripUndefinedDeep({
        ...cleanPatch,
        analysisMessageCount: Array.isArray(cleanPatch.analysisMessages)
          ? cleanPatch.analysisMessages.length
          : undefined,
        analysisImageCount: Array.isArray(cleanPatch.analysisImages) ? cleanPatch.analysisImages.length : undefined,
        lastMessagePreview: lastMessage?.text ? String(lastMessage.text).slice(0, 280) : undefined,
      });
      await setDoc(
        clipDocRef,
        {
          ...enrichedPatch,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    },
    [simcarClipsRef]
  );

  return {
    requestProcessCancel,
    cancelProcessingJobsForCard,
    persistSimcarClipHistoryEntry,
    markSimcarClipStatus,
    patchPersistedSimcarClip,
  };
}
