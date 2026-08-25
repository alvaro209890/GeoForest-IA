# Fontes da reunião

Material bruto usado para escrever o plano. **Referência metodológica apenas** — o NDFI
citado no título da reunião está fora de escopo.

| Arquivo | O que é | Peso |
|---|---|---|
| `transcricao-teams-docx.txt` | Texto extraído de `../../Reunião - Bruno e IMAP _ Assunto_ GEE e indice NDFI.docx` — transcrição **oficial do Teams**, 456 falas, com rótulo de locutor e timestamp | **Autoritativa** |
| `transcricao-whisper.txt` | Transcrição do `.mp4` gerada com `faster-whisper` (modelo `small`, pt-BR, VAD, 63 min de áudio) | Conferência cruzada |

## Por que duas

O Whisper confunde **NDVI** com **NDFI** em vários pontos — são foneticamente próximos e
o áudio é de videochamada. Por isso o DOCX manda em qualquer divergência.

Onde as duas concordam, a citação é segura. Foi o caso dos dois trechos que mais pesam
no plano:

| Assunto | DOCX | Whisper |
|---|---|---|
| A equipe calcula índice **na mão** | linha 182 (26:55) | 27:01 |
| NDVI **não basta** em 30 m por causa do pixel misto | linhas 250/252 (37:33–37:51) | 37:36–37:52 |

## Como a transcrição do vídeo foi gerada

```bash
ffmpeg -i "Reunião ... .mp4" -vn -ac 1 -ar 16000 -c:a pcm_s16le reuniao.wav
# faster-whisper: modelo "small", device cpu, compute_type int8,
# language="pt", beam_size=1, vad_filter=True (min_silence 700 ms)
```

## Onde as citações são usadas

Rastreabilidade dos requisitos R1–R11 em
[`../01-contexto-e-fontes.md`](../01-contexto-e-fontes.md), seção 3.
