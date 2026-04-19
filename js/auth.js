// js/auth.js
import { supabase } from './supabaseClient.js';

// Función para iniciar sesión de forma segura
export async function loginApp(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
    });

    if (error) {
        console.error("Error de credenciales:", error.message);
        return { success: false, message: error.message };
    }
    
    return { success: true, user: data.user };
}

// Función para cerrar sesión y borrar los tokens reales
export async function logoutApp() {
    const { error } = await supabase.auth.signOut();
    if (error) {
        console.error("Error al cerrar sesión:", error.message);
    }
    window.location.reload();
}

// Función para revisar si el usuario ya entró antes (para no pedirle clave a cada rato)
export async function checkSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
        return null; // No hay sesión válida
    }
    return data.session.user;
}