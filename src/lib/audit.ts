/**
 * Service d'Audit Centralisé (C-17)
 * Permet d'enregistrer les actions critiques métier liées à un tenant et un utilisateur.
 */

import { Request } from "express";
import { pool } from "../db/pool";

export interface AuditLogOptions {
  type: 'création' | 'modification' | 'suppression' | 'connexion' | 'déconnexion' | 'transfert' | 'paiement';
  subject: string;
  action: string;
  details?: Record<string, unknown>;
}

export async function recordAudit(req: Request, options: AuditLogOptions): Promise<void> {
  try {
    const tenantId = req.tenantId;
    const userId = req.user?.id || null;

    if (!tenantId) {
      // Impossible d'auditer sans tenant context
      return;
    }

    await pool.query(
      `INSERT INTO audit_events (tenant_id, actor_user_id, type, subject, action, details)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        tenantId,
        userId,
        options.type,
        options.subject,
        options.action,
        JSON.stringify(options.details || {})
      ]
    );
  } catch (error) {
    // L'échec de l'audit ne doit jamais bloquer la requête principale, mais doit être tracé dans la console
    console.error("Erreur lors de l'enregistrement de l'événement d'audit:", error);
  }
}
