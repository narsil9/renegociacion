import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { X, Plus, AlertCircle } from 'lucide-react';

interface ClientModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function ClientModal({ onClose, onSuccess }: ClientModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states initialized with reasonable Chilean defaults
  const [formData, setFormData] = useState({
    rut: '',
    name: '',
    clave_unica_rut: '',
    clave_unica_password: '',
    nacionalidad: 'Chilena',
    fecha_nacimiento: '',
    estado_civil: '1', // Soltero(a)
    regimen_patrimonial: '',
    profesion_oficio: '12', // Agrónomos/etc (some placeholder text select)
    ocupacion: '13', // Trabajador Dependiente
    direccion: '',
    region: '13', // Región Metropolitana
    comuna: '279', // Santiago
    email: '',
    telefono_prefijo: '9', // Celular
    telefono: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => {
      const updated = { ...prev, [name]: value };
      
      // Auto-fill ClaveÚnica RUT with standard RUT when typed
      if (name === 'rut') {
        updated.clave_unica_rut = value;
      }
      return updated;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Basic Validation
    if (!formData.rut || !formData.clave_unica_password || !formData.name) {
      setError('Nombre, RUT y Contraseña ClaveÚnica son obligatorios.');
      setLoading(false);
      return;
    }

    try {
      const { error: insertError } = await supabase
        .from('clients')
        .upsert(formData, { onConflict: 'rut' });

      if (insertError) {
        throw new Error(insertError.message);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al guardar el cliente');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Agregar Nuevo Cliente (Simulación Real)</h2>
          <button className="btn-icon" onClick={onClose} disabled={loading}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#f87171',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                marginBottom: '1.25rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.85rem'
              }}>
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <div className="form-grid">
              {/* === CREDENTIALS === */}
              <div className="form-group form-group-full" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem', marginTop: '0.25rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-primary)' }}>Credenciales ClaveÚnica</span>
              </div>

              <div className="form-group">
                <label htmlFor="name">Nombre Completo</label>
                <input type="text" id="name" name="name" value={formData.name} onChange={handleChange} placeholder="Ej: Patricio Martini" required />
              </div>

              <div className="form-group">
                <label htmlFor="rut">RUT Cliente</label>
                <input type="text" id="rut" name="rut" value={formData.rut} onChange={handleChange} placeholder="Ej: 12345678-9" required />
              </div>

              <div className="form-group">
                <label htmlFor="clave_unica_password">Contraseña ClaveÚnica</label>
                <input type="password" id="clave_unica_password" name="clave_unica_password" value={formData.clave_unica_password} onChange={handleChange} placeholder="••••••••" required />
              </div>

              {/* === PERSONAL INFO === */}
              <div className="form-group form-group-full" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem', marginTop: '1rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-primary)' }}>Información Personal (Paso 1)</span>
              </div>

              <div className="form-group">
                <label htmlFor="nacionalidad">Nacionalidad</label>
                <input type="text" id="nacionalidad" name="nacionalidad" value={formData.nacionalidad} onChange={handleChange} required />
              </div>

              <div className="form-group">
                <label htmlFor="fecha_nacimiento">Fecha Nacimiento</label>
                <input type="text" id="fecha_nacimiento" name="fecha_nacimiento" value={formData.fecha_nacimiento} onChange={handleChange} placeholder="DD/MM/AAAA" required />
              </div>

              <div className="form-group">
                <label htmlFor="estado_civil">Estado Civil</label>
                <select id="estado_civil" name="estado_civil" value={formData.estado_civil} onChange={handleChange}>
                  <option value="1">Soltero(a)</option>
                  <option value="2">Casado(a)</option>
                  <option value="3">Divorciado(a)</option>
                  <option value="4">Viudo(a)</option>
                  <option value="5">Con separación judicial</option>
                  <option value="6">Conviviente Civil</option>
                  <option value="7">No informado</option>
                </select>
              </div>

              {formData.estado_civil === '2' && (
                <div className="form-group">
                  <label htmlFor="regimen_patrimonial">Régimen Patrimonial</label>
                  <select id="regimen_patrimonial" name="regimen_patrimonial" value={formData.regimen_patrimonial} onChange={handleChange}>
                    <option value="">-- Seleccionar régimen --</option>
                    <option value="1">Sociedad Conyugal</option>
                    <option value="2">Separación Total de Bienes</option>
                    <option value="3">Participación en los Gananciales</option>
                  </select>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="profesion_oficio">Profesión / Oficio</label>
                <select id="profesion_oficio" name="profesion_oficio" value={formData.profesion_oficio} onChange={handleChange}>
                  <option value="12">Agrónomos</option>
                  <option value="1">Abogados</option>
                  <option value="15">Médicos</option>
                  <option value="20">Ingenieros</option>
                  <option value="9999">Otros / Sin Especificar</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="ocupacion">Situación Laboral</label>
                <select id="ocupacion" name="ocupacion" value={formData.ocupacion} onChange={handleChange}>
                  <option value="13">Trabajador Dependiente</option>
                  <option value="14">Trabajador Independiente</option>
                  <option value="9">Cesante</option>
                  <option value="11">Estudiante</option>
                  <option value="12">Jubilado / Pensionado</option>
                </select>
              </div>

              {/* === ADDRESS & CONTACT === */}
              <div className="form-group form-group-full" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem', marginTop: '1rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-primary)' }}>Dirección y Contacto</span>
              </div>

              <div className="form-group form-group-full">
                <label htmlFor="direccion">Calle, Número y Depto</label>
                <input type="text" id="direccion" name="direccion" value={formData.direccion} onChange={handleChange} placeholder="Ej: Av Providencia 1234, Depto 41" required />
              </div>

              <div className="form-group">
                <label htmlFor="region">Región</label>
                <select id="region" name="region" value={formData.region} onChange={handleChange}>
                  <option value="13">Región Metropolitana</option>
                  <option value="5">Región de Valparaíso</option>
                  <option value="8">Región del Biobío</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="comuna">Comuna</label>
                <select id="comuna" name="comuna" value={formData.comuna} onChange={handleChange}>
                  {formData.region === '13' ? (
                    <>
                      <option value="279">Santiago</option>
                      <option value="301">Providencia</option>
                      <option value="292">Las Condes</option>
                      <option value="274">Maipú</option>
                    </>
                  ) : formData.region === '5' ? (
                    <>
                      <option value="87">Valparaíso</option>
                      <option value="89">Viña del Mar</option>
                    </>
                  ) : (
                    <>
                      <option value="199">Concepción</option>
                    </>
                  )}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="email">Correo Electrónico</label>
                <input type="email" id="email" name="email" value={formData.email} onChange={handleChange} placeholder="correo@dominio.com" required />
              </div>

              <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '0.5rem' }}>
                <div>
                  <label htmlFor="telefono_prefijo">Prefijo</label>
                  <select id="telefono_prefijo" name="telefono_prefijo" value={formData.telefono_prefijo} onChange={handleChange}>
                    <option value="9">9 (Cel)</option>
                    <option value="2">2 (Stgo)</option>
                    <option value="56">56</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="telefono">Teléfono</label>
                  <input type="text" id="telefono" name="telefono" value={formData.telefono} onChange={handleChange} placeholder="12345678" required />
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button className="btn btn-secondary" type="button" onClick={onClose} disabled={loading}>
              Cancelar
            </button>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? (
                <span>Guardando...</span>
              ) : (
                <>
                  <Plus size={16} />
                  <span>Crear Cliente</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
