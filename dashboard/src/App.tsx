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

      // 2. Fetch latest job per client — ordered desc so first result per client_id is the newest
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
      // Refresh to fix local state
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

  return (
    <div className="dashboard-container">
      {/* Header */}
      <header className="dashboard-header">
        <div className="header-title-section">
          <h1>Superir Portal Automation</h1>
          <p>Plataforma híbrida para el llenado y supervisión de renegociaciones</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary" onClick={fetchData} title="Refrescar">
            <RefreshCw size={16} />
          </button>
          <button className="btn btn-primary" onClick={() => setShowClientModal(true)}>
            <Plus size={16} />
            <span>Nuevo Cliente</span>
          </button>
        </div>
      </header>

      {/* Stats Cards */}
      <section className="stats-grid">
        <div className="stat-card">
          <div
            className="stat-icon-wrapper"
            style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-primary)' }}
          >
            <Users size={24} />
          </div>
          <div className="stat-info">
            <h3>Clientes Totales</h3>
            <p>{totalClients}</p>
          </div>
        </div>

        <div className="stat-card">
          <div
            className="stat-icon-wrapper"
            style={{ background: 'rgba(6, 182, 212, 0.1)', color: 'var(--status-running)' }}
          >
            <Loader2 size={24} className={activeJobs > 0 ? 'spinner' : ''} />
          </div>
          <div className="stat-info">
            <h3>Trabajos Activos</h3>
            <p>{activeJobs}</p>
          </div>
        </div>

        <div className="stat-card">
          <div
            className="stat-icon-wrapper"
            style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--status-success)' }}
          >
            <CheckCircle2 size={24} />
          </div>
          <div className="stat-info">
            <h3>Completados</h3>
            <p>{successJobs}</p>
          </div>
        </div>

        <div className="stat-card">
          <div
            className="stat-icon-wrapper"
            style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--status-failed)' }}
          >
            <XCircle size={24} />
          </div>
          <div className="stat-info">
            <h3>Tasa de Éxito</h3>
            <p>{successRate}% <span style={{ fontSize: '0.8rem', fontWeight: 400, color: 'var(--text-muted)' }}>({failedJobs} fallidos)</span></p>
          </div>
        </div>
      </section>

      {/* Main Table section */}
      <main className="table-container">
        <div className="table-header-section">
          <h2>Lista de Clientes y Estado de Trámites</h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Estado de los trabajos en tiempo real
          </span>
        </div>

        {loading && clients.length === 0 ? (
          <div className="loading-indicator">
            <Loader2 size={24} className="spinner" />
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
              <Plus size={16} />
              <span>Registrar tu primer cliente</span>
            </button>
          </div>
        ) : (
          <table className="clients-table">
            <thead>
              <tr>
                <th>Cliente / RUT</th>
                <th>Contacto</th>
                <th>Dirección</th>
                <th>Estado de Automatización</th>
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
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                          <Mail size={12} style={{ color: 'var(--text-muted)' }} />
                          {client.email}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          <Phone size={12} style={{ color: 'var(--text-muted)' }} />
                          +{client.telefono_prefijo} {client.telefono}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', fontSize: '0.8rem' }}>
                        <span>{client.direccion}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          Comuna {client.comuna} (R-{client.region})
                        </span>
                      </div>
                    </td>
                    <td>
                      {!latestJob ? (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          Sin ejecutar aún
                        </span>
                      ) : latestJob.status === 'pending' ? (
                        <span className="badge badge-pending">
                          <Loader2 size={12} className="spinner" />
                          <span>En Cola</span>
                        </span>
                      ) : latestJob.status === 'running' ? (
                        <span className="badge badge-running">
                          <Loader2 size={12} className="spinner" />
                          <span>Procesando...</span>
                        </span>
                      ) : latestJob.status === 'success' ? (
                        <span className="badge badge-success">
                          <CheckCircle2 size={12} />
                          <span>Paso 1 Listo</span>
                        </span>
                      ) : (
                        <span className="badge badge-failed">
                          <XCircle size={12} />
                          <span>Fallo Paso {latestJob.step}</span>
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="action-cell">
                        {/* Execute Button */}
                        <button
                          className="btn btn-action-run"
                          onClick={() => triggerStep1(client.id)}
                          disabled={
                            latestJob?.status === 'pending' || latestJob?.status === 'running'
                          }
                          title="Ejecutar Paso 1 automáticamente"
                        >
                          <Play size={14} fill="currentColor" />
                          <span>Correr Paso 1</span>
                        </button>

                        {/* Diagnostics Button */}
                        {latestJob?.status === 'failed' && (
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '0.5rem 0.75rem', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#f87171' }}
                            onClick={() =>
                              setSelectedDiagnostic({
                                clientName: client.name,
                                rut: client.rut,
                                step: latestJob.step,
                                errorLog: latestJob.error_log,
                                screenshotUrl: latestJob.screenshot_url,
                              })
                            }
                            title="Ver detalles del fallo"
                          >
                            <Terminal size={14} />
                            <span>Ver Fallo</span>
                          </button>
                        )}

                        {/* success manual confirmation banner */}
                        {latestJob?.status === 'success' && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              fontSize: '0.75rem',
                              color: 'var(--status-success)',
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
        )}
      </main>

      {/* Modals Mounting */}
      {showClientModal && (
        <ClientModal
          onClose={() => setShowClientModal(false)}
          onSuccess={() => {
            fetchData();
            alert('Cliente registrado con éxito.');
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
