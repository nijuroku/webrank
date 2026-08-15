// connect.js — centraliza las interacciones con Supabase
// Usa CONFIG desde config.js (debe cargarse antes)
(function () {
    if (typeof CONFIG === 'undefined') {
        console.warn('CONFIG no definido. Asegúrate de incluir config.js antes de connect.js');
    }

    const SUPABASE_URL = (typeof CONFIG !== 'undefined' && CONFIG.SUPABASE_URL) ? CONFIG.SUPABASE_URL : (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '');
    const SUPABASE_ANON_KEY = (typeof CONFIG !== 'undefined' && CONFIG.SUPABASE_ANON_KEY) ? CONFIG.SUPABASE_ANON_KEY : (typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '');

    // Crear cliente y exponerlo en window.supabase para compatibilidad con el código existente
    try {
        if (!window.supabase || !window.supabase.createClient) {
            console.error('La librería de Supabase no está disponible en window.supabase');
        } else {
            // Reemplaza window.supabase con el cliente para que el resto del código use la misma referencia
            window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }
    } catch (e) {
        console.error('Error creando cliente Supabase:', e);
    }

    // API para operaciones de DB y auth
    window.supabaseApi = {
        async testSupabaseConnection() {
            try {
                const { data, error } = await window.supabase
                    .from('torneos')
                    .select('count')
                    .limit(1);
                if (error) throw error;
                return true;
            } catch (error) {
                console.error('❌ Error de conexión (supabaseApi):', error);
                return false;
            }
        },

        async initSupabaseAuth(currentUserNickname) {
            try {
                const { data: { session }, error: sessionError } = await window.supabase.auth.getSession();
                if (sessionError) {
                    console.error('Error al obtener sesión (supabaseApi):', sessionError);
                }

                if (session?.user) {
                    if (currentUserNickname) {
                        const { error: updateError } = await window.supabase.auth.updateUser({ data: { nickname: currentUserNickname } });
                        if (updateError) console.warn('⚠️ Error al actualizar metadata (supabaseApi):', updateError);
                    }
                    return session;
                }

                const { data, error } = await window.supabase.auth.signInAnonymously({
                    options: {
                        data: {
                            nickname: currentUserNickname || 'Árbitro',
                            device: navigator.userAgent || 'unknown'
                        }
                    }
                });

                if (error) {
                    console.error('Error al iniciar sesión anónima (supabaseApi):', error);
                    return null;
                }

                if (data?.user) {
                    return data;
                }
                return null;
            } catch (error) {
                console.error('Error en autenticación (supabaseApi):', error);
                return null;
            }
        },

        async addArbitro(torneoId, rol = 'arbitro', userId, userName) {
            try {
                if (!userId) userId = 'anonymous';
                const { data: existing } = await window.supabase
                    .from('arbitros')
                    .select('*')
                    .eq('torneo_id', torneoId)
                    .eq('usuario_id', userId)
                    .maybeSingle();

                if (existing) return { data: existing, error: null };

                const { data, error } = await window.supabase
                    .from('arbitros')
                    .insert([{ torneo_id: torneoId, usuario_id: userId, nombre_arbitro: userName, rol }])
                    .select()
                    .single();

                if (error) throw error;
                return { data, error: null };
            } catch (error) {
                console.error('Error al agregar árbitro (supabaseApi):', error);
                return { data: null, error };
            }
        },

        async loadTournamentFromSupabase(torneoId) {
            try {
                const [torneo, participantes, partidos, arbitros, resultados] = await Promise.all([
                    window.supabase.from('torneos').select('*').eq('id', torneoId).single(),
                    window.supabase.from('participantes').select('*').eq('torneo_id', torneoId).order('nombre'),
                    window.supabase.from('partidos').select('*').eq('torneo_id', torneoId).order('ronda', { ascending: true }),
                    window.supabase.from('arbitros').select('*').eq('torneo_id', torneoId),
                    window.supabase.from('resultados_finales').select('*').eq('torneo_id', torneoId).maybeSingle()
                ]);

                if (torneo.error) throw torneo.error;
                if (participantes.error) throw participantes.error;
                if (partidos.error) throw partidos.error;

                return {
                    torneo: torneo.data,
                    participantes: participantes.data || [],
                    partidos: partidos.data || [],
                    arbitros: arbitros.data || [],
                    resultados: resultados.data || null,
                    error: null
                };
            } catch (error) {
                console.error('Error al cargar torneo (supabaseApi):', error);
                return { error };
            }
        },

        // Guarda participantes, partidos y resultados. Recibe un objeto 'state' con los datos necesarios.
        async saveFullStateToSupabase(state = {}) {
            // state debe incluir: currentTournamentId, tournamentName, currentPhase, groupRound, knockoutRound,
            // tournamentFinished, customQualifiedCount, participants, accumulatedPoints, matchHistory, versus, podium
            try {
                const currentTournamentId = state.currentTournamentId;
                if (!currentTournamentId) return { error: 'No tournament id' };

                const estadoCompleto = state.estadoCompleto || {};

                // Actualizar torneo
                const { error: torneoError } = await window.supabase
                    .from('torneos')
                    .update({
                        nombre: state.tournamentName,
                        fase_actual: state.currentPhase,
                        ronda_grupo: state.groupRound,
                        ronda_eliminatoria: state.knockoutRound,
                        finalizado: state.tournamentFinished,
                        configuracion: { clasificados: state.customQualifiedCount },
                        estado_completo: estadoCompleto,
                        fecha_actualizacion: new Date().toISOString()
                    })
                    .eq('id', currentTournamentId);
                if (torneoError) console.error('Error actualizando torneo (supabaseApi):', torneoError);

                // Participantes: upsert
                const participantes = state.participants || [];
                for (const name of participantes) {
                    const { error } = await window.supabase
                        .from('participantes')
                        .upsert({ torneo_id: currentTournamentId, nombre: name, puntos_acumulados: (state.accumulatedPoints || {})[name] || 0 }, { onConflict: 'torneo_id,nombre' });
                    if (error) console.error('Error al guardar participante (supabaseApi):', error);
                }

                // Obtener IDs actuales
                const { data: participantesDB } = await window.supabase
                    .from('participantes')
                    .select('id, nombre')
                    .eq('torneo_id', currentTournamentId);
                const nameToId = {};
                if (participantesDB) participantesDB.forEach(p => { nameToId[p.nombre] = p.id; });

                const allMatches = [...(state.matchHistory || []), ...(state.versus || [])];
                for (const match of allMatches) {
                    const jugadorAId = nameToId[match.playerA];
                    const jugadorBId = nameToId[match.playerB];
                    if (!jugadorAId || !jugadorBId) continue;

                    let ganadorId = null;
                    if (match.jugado && match.scoreA !== match.scoreB) {
                        ganadorId = match.scoreA > match.scoreB ? jugadorAId : jugadorBId;
                    }

                    const matchData = {
                        torneo_id: currentTournamentId,
                        jugador_a_id: jugadorAId,
                        jugador_b_id: jugadorBId,
                        fase: match.fase || 'grupos',
                        ronda: match.round || 0,
                        score_a: match.scoreA || 0,
                        score_b: match.scoreB || 0,
                        jugado: match.jugado || false,
                        ganador_id: ganadorId,
                        fecha_partido: match.fecha || new Date().toISOString()
                    };

                    if (match.dbId) {
                        const { error } = await window.supabase
                            .from('partidos')
                            .update(matchData)
                            .eq('id', match.dbId);
                        if (error) console.error('Error al actualizar partido (supabaseApi):', error);
                    } else {
                        const { data: existing } = await window.supabase
                            .from('partidos')
                            .select('id')
                            .eq('torneo_id', currentTournamentId)
                            .eq('jugador_a_id', jugadorAId)
                            .eq('jugador_b_id', jugadorBId)
                            .eq('ronda', match.round || 0)
                            .maybeSingle();

                        if (existing) {
                            const { error } = await window.supabase
                                .from('partidos')
                                .update(matchData)
                                .eq('id', existing.id);
                            if (error) console.error('Error al actualizar partido existente (supabaseApi):', error);
                        } else {
                            const { error } = await window.supabase
                                .from('partidos')
                                .insert(matchData);
                            if (error) console.error('Error al insertar partido (supabaseApi):', error);
                        }
                    }
                }

                // Resultados finales
                if (state.tournamentFinished) {
                    await window.supabase
                        .from('resultados_finales')
                        .upsert({
                            torneo_id: currentTournamentId,
                            campeon_id: nameToId[(state.podium || {}).first] || null,
                            subcampeon_id: nameToId[(state.podium || {}).second] || null,
                            tercer_id: nameToId[(state.podium || {}).third] || null,
                            cuarto_id: nameToId[(state.podium || {}).fourth] || null,
                            fecha_finalizacion: new Date().toISOString()
                        }, { onConflict: 'torneo_id' });
                }

                return { error: null };
            } catch (error) {
                console.error('Error en saveFullStateToSupabase (supabaseApi):', error);
                return { error };
            }
        },

        // Crea y devuelve una suscripción a canales en tiempo real
        createTournamentSubscription(torneoId, callbacks = {}) {
            try {
                const channel = window.supabase
                    .channel('torneo-' + torneoId)
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'torneos', filter: `id=eq.${torneoId}` }, (payload) => callbacks.onChange && callbacks.onChange(payload))
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'participantes', filter: `torneo_id=eq.${torneoId}` }, (payload) => callbacks.onChange && callbacks.onChange(payload))
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'partidos', filter: `torneo_id=eq.${torneoId}` }, (payload) => callbacks.onChange && callbacks.onChange(payload))
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'arbitros', filter: `torneo_id=eq.${torneoId}` }, (payload) => callbacks.onChange && callbacks.onChange(payload))
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'resultados_finales', filter: `torneo_id=eq.${torneoId}` }, (payload) => callbacks.onChange && callbacks.onChange(payload))
                    .subscribe((status) => {
                        if (callbacks.onStatus) callbacks.onStatus(status);
                    });

                return channel;
            } catch (error) {
                console.error('Error creando suscripción (supabaseApi):', error);
                return null;
            }
        },

        // Obtener torneos del usuario (basado en joining as arbitro)
        async getUserTournaments(userId, currentTournamentId) {
            try {
                const authUser = await window.supabase.auth.getUser();
                const authUid = authUser?.data?.user?.id || null;
                const uid = userId || authUid;
                if (!uid) return { data: [], error: new Error('User id missing') };

                const { data: arbitros, error: arbError } = await window.supabase
                    .from('arbitros')
                    .select('torneo_id')
                    .eq('usuario_id', uid);

                if (arbError) throw arbError;
                if (!arbitros || arbitros.length === 0) return { data: [], error: null };

                const torneoIds = arbitros.map(a => a.torneo_id);

                const { data: torneos, error: torneoError } = await window.supabase
                    .from('torneos')
                    .select('*')
                    .in('id', torneoIds)
                    .order('fecha_actualizacion', { ascending: false });

                if (torneoError) throw torneoError;

                const torneosConConteo = await Promise.all(torneos.map(async (t) => {
                    const { count } = await window.supabase
                        .from('participantes')
                        .select('*', { count: 'exact', head: true })
                        .eq('torneo_id', t.id);

                    return {
                        ...t,
                        participantes_count: count || 0,
                        es_actual: t.id === currentTournamentId
                    };
                }));

                return { data: torneosConConteo, error: null };
            } catch (error) {
                console.error('Error al obtener torneos (supabaseApi):', error);
                return { data: [], error };
            }
        },

        // Descargar torneo como JSON
        async downloadTournamentAsJSON(torneoId) {
            try {
                const { data, error } = await window.supabase
                    .from('torneos')
                    .select('*')
                    .eq('id', torneoId)
                    .single();

                if (error) throw error;
                if (!data) throw new Error('Torneo no encontrado');

                // Retornar el estado completo junto con metadatos
                return {
                    data: {
                        torneoId: data.id,
                        nombre: data.nombre,
                        codigo: data.codigo,
                        estado: data.estado_completo || {},
                        metadatos: {
                            creado: data.fecha_creacion,
                            actualizado: data.fecha_actualizacion,
                            fase: data.fase_actual,
                            finalizado: data.finalizado
                        }
                    },
                    error: null
                };
            } catch (error) {
                console.error('Error al descargar torneo (supabaseApi):', error);
                return { data: null, error };
            }
        },

        // Cargar/importar torneo desde JSON
        async importTournamentFromJSON(torneoId, jsonData) {
            try {
                if (!torneoId || !jsonData) {
                    throw new Error('Tournament ID y JSON data requeridos');
                }

                // Validar que el JSON tenga la estructura esperada
                if (!jsonData.participants || !Array.isArray(jsonData.participants)) {
                    throw new Error('JSON inválido: falta participants');
                }

                // Actualizar el torneo con el estado completo
                const { error } = await window.supabase
                    .from('torneos')
                    .update({
                        estado_completo: jsonData,
                        fecha_actualizacion: new Date().toISOString()
                    })
                    .eq('id', torneoId);

                if (error) throw error;

                return { error: null, message: 'Torneo importado correctamente' };
            } catch (error) {
                console.error('Error al importar torneo (supabaseApi):', error);
                return { error };
            }
        },

        // Obtener el JSON del torneo guardado
        async getTournamentJSON(torneoId) {
            try {
                const { data, error } = await window.supabase
                    .from('torneos')
                    .select('estado_completo')
                    .eq('id', torneoId)
                    .single();

                if (error) throw error;
                if (!data || !data.estado_completo) {
                    throw new Error('No hay datos JSON guardados para este torneo');
                }

                return {
                    data: data.estado_completo,
                    error: null
                };
            } catch (error) {
                console.error('Error al obtener JSON (supabaseApi):', error);
                return { data: null, error };
            }
        }
            try {
                const { error } = await window.supabase
                    .from('torneos')
                    .delete()
                    .eq('id', torneoId);
                if (error) throw error;
                return { error: null };
            } catch (error) {
                console.error('Error al eliminar torneo (supabaseApi):', error);
                return { error };
            }
        },

        async checkTournamentStatus(torneoId) {
            if (!torneoId) return { data: null, error: null };
            try {
                const { data, error } = await window.supabase
                    .from('torneos')
                    .select('id, nombre, codigo, finalizado, fecha_actualizacion')
                    .eq('id', torneoId)
                    .single();
                if (error) throw error;
                return { data, error: null };
            } catch (error) {
                console.error('Error al verificar torneo (supabaseApi):', error);
                return { data: null, error };
            }
        },

        async joinTournamentByCode(codigo, userId) {
            try {
                const cleanCode = (codigo || '').replace(/[\s-]/g, '').toUpperCase();
                const { data: torneo, error: findError } = await window.supabase
                    .from('torneos')
                    .select('*')
                    .eq('codigo', cleanCode)
                    .single();
                if (findError) throw findError;
                if (!torneo) throw new Error('Código inválido');

                const uid = userId || ((await window.supabase.auth.getUser())?.data?.user?.id);
                const { data: existing } = await window.supabase
                    .from('arbitros')
                    .select('*')
                    .eq('torneo_id', torneo.id)
                    .eq('usuario_id', uid)
                    .maybeSingle();

                if (!existing) {
                    await this.addArbitro(torneo.id, 'arbitro', uid, (await window.supabase.auth.getUser())?.data?.user?.email || '');
                }

                return { data: torneo, error: null };
            } catch (error) {
                console.error('Error al unirse al torneo (supabaseApi):', error);
                return { data: null, error };
            }
        },

        async crearTorneoConCodigo(nombre, codigo, createdBy) {
            try {
                const { data: torneo, error } = await window.supabase
                    .from('torneos')
                    .insert([{ nombre: nombre.trim(), codigo: codigo, configuracion: { clasificados: 8 }, estado: 'activo', fase_actual: 1, ronda_grupo: 0, ronda_eliminatoria: 0, finalizado: false, creado_por: createdBy }])
                    .select()
                    .single();
                if (error) throw error;
                return { data: torneo, error: null };
            } catch (error) {
                console.error('Error creando torneo con código (supabaseApi):', error);
                const nuevoCodigo = (Math.random().toString(36).substring(2, 7)).toUpperCase();
                return await this.crearTorneoConCodigo(nombre, nuevoCodigo, createdBy);
            }
        },

        async createTournament(nombre, createdBy, customQualifiedCount) {
            try {
                const codigo = (Math.random().toString(36).substring(2, 8)).toUpperCase();
                const { data: existing, error: checkError } = await window.supabase
                    .from('torneos')
                    .select('codigo')
                    .eq('codigo', codigo)
                    .maybeSingle();
                if (checkError) throw checkError;
                let finalCode = codigo;
                if (existing) finalCode = (Math.random().toString(36).substring(2, 8)).toUpperCase();

                const { data: torneo, error: createError } = await window.supabase
                    .from('torneos')
                    .insert([{
                        nombre: nombre.trim(),
                        codigo: finalCode,
                        configuracion: { clasificados: customQualifiedCount || 8 },
                        estado: 'activo',
                        fase_actual: 1,
                        ronda_grupo: 0,
                        ronda_eliminatoria: 0,
                        finalizado: false,
                        creado_por: createdBy
                    }])
                    .select()
                    .single();

                if (createError) throw createError;

                await this.addArbitro(torneo.id, 'admin', createdBy, (await window.supabase.auth.getUser())?.data?.user?.email || createdBy);
                return { data: torneo, error: null };
            } catch (error) {
                console.error('Error creando torneo (supabaseApi):', error);
                return { data: null, error };
            }
        },

        async isUserArbitro(torneoId, userId) {
            try {
                const uid = userId || ((await window.supabase.auth.getUser())?.data?.user?.id);
                const { data: arbitro, error } = await window.supabase.from('arbitros').select('*').eq('torneo_id', torneoId).eq('usuario_id', uid).maybeSingle();
                if (error) throw error;
                return { data: arbitro, error: null };
            } catch (error) {
                console.error('Error verificando arbitro (supabaseApi):', error);
                return { data: null, error };
            }
        }
    };
})();