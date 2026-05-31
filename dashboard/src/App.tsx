import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { ClientModal } from './components/ClientModal';
import { JobDiagnosticModal } from './components/JobDiagnosticModal';
import {
  Users,
  Play,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Plus,
  Phone,
  Mail,
  Terminal,
  ShieldCheck,
  RefreshCw,
  LayoutGrid,
  Settings,
  LogOut,
  Activity,
} from 'lucide-react';

interface Client {
  id: string;
  rut: string;
  name: string;
  email: string;
  telefono_prefijo: string;
  telefono: string;
  direccion: string;
  comuna: string;
  region: string;
}

interface Job {
  id: string;
  client_id: string;
  step: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  error_log: string | null;
  screenshot_url: string | null;
  created_at: string;
  updated_at: string;
}

export default function App() {
  const [clients, setClients] = useState<Client[]>([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({}); // Key: client_id
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modals
  const [showClientModal, setShowClientModal] = useState(false);
  const [selectedDiagnostic, setSelectedDiagnostic] = useState<{
    clientName: string;
    rut: string;
    step: number;
    errorLog: string | null;
    screenshotUrl: string | null;
  } | null>(null);

  // Fetch initial data
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch Clients
      const { data: clientsData, error: clientsError } = await supabase
        .from('clients')
        .select('*')
        .order('name', { ascending: true });

      if (clientsError) throw new Error(clientsError.message);
      setClients(clientsData || []);

      // 2. Fetch latest job per client
      const { data: jobsData, error: jobsError } = await supabase
        .from('automation_jobs')
        .select('*')
        .order('created_at', { ascending: false });

      if (jobsError) throw new Error(jobsError.message);

      // Keep only the first (most recent) job per client
      const latestJobs: Record<string, Job> = {};
      if (jobsData) {
        jobsData.forEach((job: Job) => {
          if (!latestJobs[job.client_id]) {
            latestJobs[job.client_id] = job;
          }
        });
      }
      setJobs(latestJobs);

    } catch (err: any) {
      setError(err.message || 'Error al obtener datos de Supabase');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // 3. Subscribe to Real-time updates for automation_jobs
    const channel = supabase
      .channel('automation_jobs_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'automation_jobs',
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const deletedJob = payload.old as Job;
            if (deletedJob?.client_id) {
              setJobs((prev) => {
                const next = { ...prev };
                delete next[deletedJob.client_id];
                return next;
              });
            }
            return;
          }
          const updatedJob = payload.new as Job;
          if (updatedJob && updatedJob.client_id) {
            setJobs((prev) => ({
              ...prev,
              [updatedJob.client_id]: updatedJob,
            }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Trigger automation run
  const triggerStep1 = async (clientId: string) => {
    try {
      // Create a temporary loading job locally
      setJobs((prev) => ({
        ...prev,
        [clientId]: {
          id: 'temp',
          client_id: clientId,
          step: 1,
          status: 'pending',
          error_log: null,
          screenshot_url: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }));

      // Insert job in Supabase
      const { error: insertError } = await supabase
        .from('automation_jobs')
        .insert({
          client_id: clientId,
          step: 1,
          status: 'pending',
        });

      if (insertError) {
        throw new Error(insertError.message);
      }
    } catch (err: any) {
      alert(`Error al iniciar automatización: ${err.message}`);
      fetchData();
    }
  };

  // Stats Calculations
  const totalClients = clients.length;
  const activeJobs = Object.values(jobs).filter(
    (j) => j.status === 'pending' || j.status === 'running'
  ).length;
  const successJobs = Object.values(jobs).filter((j) => j.status === 'success').length;
  const failedJobs = Object.values(jobs).filter((j) => j.status === 'failed').length;

  const successRate =
    successJobs + failedJobs > 0
      ? Math.round((successJobs / (successJobs + failedJobs)) * 100)
      : 0;

  // Retrieve the absolute newest job in the system to show in the live status card
  const latestOverallJob = Object.values(jobs).reduce<Job | null>((latest, current) => {
    if (!latest) return current;
    // Skip local 'temp' job
    if (current.id === 'temp') return latest;
    if (latest.id === 'temp') return current;
    return new Date(current.created_at) > new Date(latest.created_at) ? current : latest;
  }, null);

  const latestJobClient = latestOverallJob
    ? clients.find((c) => c.id === latestOverallJob.client_id)
    : null;

  return (
    <div className="app-layout">
      {/* Left Navigation Bar */}
      <aside className="app-sidebar">
        <div className="logo-wrapper">
          <div className="logo-icon"></div>
        </div>
        
        <nav className="sidebar-nav">
          <button className="nav-item active" title="Dashboard">
            <LayoutGrid size={18} />
          </button>
          
          <button className="nav-item" title="Nuevo Cliente" onClick={() => setShowClientModal(true)}>
            <Plus size={18} />
          </button>
          
          <button className="nav-item" title="Forzar Sincronización" onClick={fetchData}>
            <RefreshCw size={18} />
          </button>
          
          <div className="nav-separator" />
          
          <button className="nav-item" title="Configuración">
            <Settings size={18} />
          </button>
        </nav>

        <div className="sidebar-footer">
          <button className="nav-item" title="Salir">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* Main Container */}
      <main className="main-container">
        
        {/* Header */}
        <header className="dashboard-header">
          <div className="header-title-section">
            <h1>Solicitudes de Renegociación</h1>
            <p>Monitoreo y automatización de trámites de renegociación ante la Superintendencia</p>
          </div>
          
          <div className="header-actions">
            <div className="worker-status-badge">
              <div className="status-indicator-dot pulse" />
              <span>Robot Automatizador: CONECTADO</span>
            </div>
            
            <button className="btn btn-secondary" onClick={fetchData} title="Refrescar datos">
              <RefreshCw size={14} />
            </button>
            
            <button className="btn btn-primary" onClick={() => setShowClientModal(true)}>
              <Plus size={14} />
              <span>Nuevo Cliente</span>
            </button>
          </div>
        </header>

        {/* Dashboard Grid System */}
        <div className="dashboard-grid">
          
          {/* Main Content Column (Left, ~67%) */}
          <div className="main-content-column">
            
            {/* Live Queue Monitor Widget */}
            <div className="execution-status-card dashboard-card">
              <div className="card-header">
                <h2>Estado del Robot en Tiempo Real</h2>
                <span className="card-subtitle">Progreso de la última solicitud procesada</span>
              </div>
              
              {!latestOverallJob ? (
                <div className="queue-empty-state">
                  <Activity size={32} style={{ marginBottom: '0.5rem', opacity: 0.3, color: 'var(--accent-primary)' }} />
                  <p>No hay solicitudes pendientes en este momento.</p>
                </div>
              ) : (
                <div className="queue-active-layout">
                  <div className="queue-details-block">
                    <span className="queue-label">Cliente</span>
                    <span className="queue-value-rut">{latestJobClient ? latestJobClient.name : 'Cargando...'}</span>
                    <span className="queue-value-name">{latestJobClient ? `RUT: ${latestJobClient.rut}` : ''}</span>
                    
                    <div className="queue-indicator-group">
                      {latestOverallJob.status === 'pending' && (
                        <span className="badge badge-pending">
                          <Loader2 size={12} className="spinner" />
                          <span>En Cola de Espera</span>
                        </span>
                      )}
                      {latestOverallJob.status === 'running' && (
                        <span className="badge badge-running">
                          <Loader2 size={12} className="spinner" />
                          <span>Rellenando Paso {latestOverallJob.step}</span>
                        </span>
                      )}
                      {latestOverallJob.status === 'success' && (
                        <span className="badge badge-success">
                          <CheckCircle2 size={12} />
                          <span>Paso {latestOverallJob.step} Completado</span>
                        </span>
                      )}
                      {latestOverallJob.status === 'failed' && (
                        <span className="badge badge-failed">
                          <XCircle size={12} />
                          <span>Fallo en Paso {latestOverallJob.step}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="queue-progress-bar-container">
                    <span className="queue-live-logs-title">Progreso del Trámite</span>
                    <div className="queue-live-console">
                      {latestOverallJob.status === 'pending' && '⏳ Esperando que el robot inicie la solicitud...'}
                      {latestOverallJob.status === 'running' && '🤖 Ingresando al portal y completando el Paso 1 (Datos Personales)...'}
                      {latestOverallJob.status === 'success' && '✓ Paso 1 guardado con éxito. Listo para ingresar declaraciones.'}
                      {latestOverallJob.status === 'failed' && `❌ Detención: ${latestOverallJob.error_log?.split('\n').filter(Boolean).pop() || 'Desconocido'}`}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Main Table: Clients & Jobs */}
            <div className="dashboard-card table-card">
              <div className="card-header">
                <h2>Lista de Clientes y Estado de Trámites</h2>
                <span className="card-subtitle">Presione "Correr Paso 1" para iniciar el ingreso automático</span>
              </div>

              {loading && clients.length === 0 ? (
                <div className="loading-indicator">
                  <Loader2 size={20} className="spinner" />
                  <span>Cargando datos desde Supabase...</span>
                </div>
              ) : error ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: '#ef4444' }}>
                  <AlertCircle size={32} style={{ marginBottom: '1rem' }} />
                  <p>{error}</p>
                </div>
              ) : clients.length === 0 ? (
                <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  <Users size={48} style={{ marginBottom: '1rem', opacity: 0.3 }} />
                  <p>No hay clientes registrados en la base de datos.</p>
                  <button
                    className="btn btn-primary"
                    style={{ marginTop: '1.25rem' }}
                    onClick={() => setShowClientModal(true)}
                  >
                    <Plus size={14} />
                    <span>Registrar tu primer cliente</span>
                  </button>
                </div>
              ) : (
                <div className="table-wrapper">
                  <table className="clients-table">
                    <thead>
                      <tr>
                        <th>Cliente / RUT</th>
                        <th>Contacto</th>
                        <th>Dirección</th>
                        <th>Estado del Trámite</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clients.map((client) => {
                        const latestJob = jobs[client.id];
                        
                        return (
                          <tr key={client.id}>
                            <td>
                              <div className="client-name-cell">
                                <span className="name">{client.name}</span>
                                <span className="email">{client.rut}</span>
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                  <Mail size={12} style={{ color: 'var(--text-muted)' }} />
                                  {client.email}
                                </span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  <Phone size={12} style={{ color: 'var(--text-muted)' }} />
                                  +{client.telefono_prefijo} {client.telefono}
                                </span>
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                <span>{client.direccion}</span>
                                <span style={{ color: 'var(--text-muted)' }}>
                                  Comuna {client.comuna} (Región {client.region})
                                </span>
                              </div>
                            </td>
                            <td>
                              {!latestJob ? (
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                  Pendiente de inicio
                                </span>
                              ) : latestJob.status === 'pending' ? (
                                <span className="badge badge-pending">
                                  <Loader2 size={10} className="spinner" />
                                  <span>En Cola</span>
                                </span>
                              ) : latestJob.status === 'running' ? (
                                <span className="badge badge-running">
                                  <Loader2 size={10} className="spinner" />
                                  <span>Procesando...</span>
                                </span>
                              ) : latestJob.status === 'success' ? (
                                <span className="badge badge-success">
                                  <CheckCircle2 size={10} />
                                  <span>Paso 1 Listo</span>
                                </span>
                              ) : (
                                <span className="badge badge-failed">
                                  <XCircle size={10} />
                                  <span>Fallo Paso {latestJob.step}</span>
                                </span>
                              )}
                            </td>
                            <td>
                              <div className="action-cell">
                                <button
                                  className="btn btn-action-run"
                                  onClick={() => triggerStep1(client.id)}
                                  disabled={
                                    latestJob?.status === 'pending' || latestJob?.status === 'running'
                                  }
                                  title="Iniciar ingreso de datos automático para Paso 1"
                                >
                                  <Play size={12} fill="currentColor" />
                                  <span>Correr Paso 1</span>
                                </button>

                                {latestJob?.status === 'failed' && (
                                  <button
                                    className="btn btn-secondary"
                                    style={{ padding: '0.45rem 0.75rem', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}
                                    onClick={() =>
                                      setSelectedDiagnostic({
                                        clientName: client.name,
                                        rut: client.rut,
                                        step: latestJob.step,
                                        errorLog: latestJob.error_log,
                                        screenshotUrl: latestJob.screenshot_url,
                                      })
                                    }
                                    title="Ver bitácora del error"
                                  >
                                    <Terminal size={12} />
                                    <span>Ver Fallo</span>
                                  </button>
                                )}

                                {latestJob?.status === 'success' && (
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.25rem',
                                      fontSize: '0.75rem',
                                      color: 'var(--status-success)',
                                      fontWeight: '600'
                                    }}
                                  >
                                    <ShieldCheck size={14} />
                                    <span>Listo para Paso 2</span>
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Stats Sidebar Column (Right, ~33%) */}
          <div className="stats-sidebar-column">
            
            {/* Card: Total Clients */}
            <div className="stat-card">
              <div className="stat-header">
                <span className="stat-title">Clientes Totales</span>
                <Users className="stat-icon" size={16} />
              </div>
              <div className="stat-value">{totalClients}</div>
              <span className="stat-desc">Registrados en el sistema</span>
            </div>

            {/* Card: Active Jobs */}
            <div className="stat-card">
              <div className="stat-header">
                <span className="stat-title">Trámites Activos</span>
                <Loader2 className={`stat-icon ${activeJobs > 0 ? 'spinner' : ''}`} size={16} />
              </div>
              <div className="stat-value">{activeJobs}</div>
              <span className="stat-desc">En proceso de ingreso</span>
            </div>

            {/* Card: Success Rate with SVG Arc */}
            <div className="stat-card success-rate-card">
              <div className="stat-header">
                <span className="stat-title">Tasa de Éxito</span>
                <CheckCircle2 className="stat-icon" size={16} style={{ color: 'var(--status-success)' }} />
              </div>
              
              <div className="success-rate-container">
                <div className="success-circular-progress">
                  <svg width="120" height="120" viewBox="0 0 120 120">
                    <defs>
                      <linearGradient id="orangeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#ff5722" />
                        <stop offset="100%" stopColor="#ff8f00" />
                      </linearGradient>
                    </defs>
                    <circle cx="60" cy="60" r="50" className="progress-bg" />
                    <circle 
                      cx="60" 
                      cy="60" 
                      r="50" 
                      className="progress-bar"
                      strokeDasharray={`${2 * Math.PI * 50}`}
                      strokeDashoffset={`${2 * Math.PI * 50 * (1 - successRate / 100)}`}
                    />
                  </svg>
                  <div className="success-percentage-label">{successRate}%</div>
                </div>
              </div>
              
              <div style={{ textAlign: 'center', marginTop: '0.25rem' }}>
                <span className="stat-desc">{successJobs} exitosos | {failedJobs} fallidos</span>
              </div>
            </div>

            {/* Card: Avg Runtime Speed */}
            <div className="stat-card">
              <div className="stat-header">
                <span className="stat-title">Tiempo Promedio</span>
                <Terminal className="stat-icon" size={16} />
              </div>
              <div className="stat-value">24.5s</div>
              <span className="stat-desc">Duración de ingreso por cliente</span>
            </div>
            
          </div>

        </div>
      </main>

      {/* Modals Mounting */}
      {showClientModal && (
        <ClientModal
          onClose={() => setShowClientModal(false)}
          onSuccess={() => {
            fetchData();
          }}
        />
      )}

      {selectedDiagnostic && (
        <JobDiagnosticModal
          clientName={selectedDiagnostic.clientName}
          rut={selectedDiagnostic.rut}
          step={selectedDiagnostic.step}
          errorLog={selectedDiagnostic.errorLog}
          screenshotUrl={selectedDiagnostic.screenshotUrl}
          onClose={() => setSelectedDiagnostic(null)}
        />
      )}
    </div>
  );
}
