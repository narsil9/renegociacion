import { X, Image as ImageIcon, Terminal, ExternalLink } from 'lucide-react';

interface JobDiagnosticModalProps {
  clientName: string;
  rut: string;
  step: number;
  errorLog: string | null;
  screenshotUrl: string | null;
  onClose: () => void;
}

export function JobDiagnosticModal({
  clientName,
  rut,
  step,
  errorLog,
  screenshotUrl,
  onClose,
}: JobDiagnosticModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content modal-content-lg"
        onClick={(e) => e.stopPropagation()} // Prevent close on modal inside click
      >
        <div className="modal-header">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>Diagnóstico de Fallo</span>
              <span className="badge badge-failed" style={{ fontSize: '0.65rem' }}>
                Fallo Paso {step}
              </span>
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              Cliente: <b>{clientName}</b> ({rut})
            </p>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body diagnostic-container">
          {/* Screenshot Block */}
          <div>
            <h3
              style={{
                fontSize: '0.85rem',
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
                fontWeight: 600,
                marginBottom: '0.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <ImageIcon size={16} />
              <span>Captura de Pantalla al Momento del Error</span>
            </h3>
            {screenshotUrl ? (
              <div style={{ position: 'relative' }}>
                <img
                  src={screenshotUrl}
                  alt="Captura de pantalla de error de automatización"
                  className="diagnostic-screenshot"
                />
                <a
                  href={screenshotUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    position: 'absolute',
                    bottom: '12px',
                    right: '12px',
                    background: 'rgba(0, 0, 0, 0.7)',
                    padding: '0.4rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    color: '#fff',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  <span>Abrir en nueva pestaña</span>
                  <ExternalLink size={12} />
                </a>
              </div>
            ) : (
              <div
                style={{
                  height: '140px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px dashed var(--card-border)',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '0.85rem',
                }}
              >
                No se capturó captura de pantalla para este error.
              </div>
            )}
          </div>

          {/* Console Logs Block */}
          <div>
            <h3
              className="diagnostic-logs-title"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Terminal size={16} />
              <span>Historial del Script de Ejecución (Logs)</span>
            </h3>
            <div className="diagnostic-logs-console">
              {errorLog ? errorLog : 'El script de ejecución no reportó bitácora detallada.'}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cerrar Diagnóstico
          </button>
        </div>
      </div>
    </div>
  );
}
