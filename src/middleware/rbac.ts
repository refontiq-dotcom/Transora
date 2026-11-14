/**
 * Politique RBAC centralisée de TRANSORA.
 * Les rôles proviennent du JWT signé côté serveur et sont limités par la migration 007.
 */
import { NextFunction, Request, Response } from "express";

export type Permission =
  | "dashboard.read" | "voyages.read" | "voyages.manage" | "bookings.create"
  | "seats.read" | "seats.manage" | "payments.read" | "payments.manage"
  | "finance.read" | "finance.manage" | "fleet.read" | "fleet.update" | "fleet.manage" | "personnel.read"
  | "personnel.manage" | "incidents.read" | "incidents.report" | "incidents.manage"
  | "notifications.read" | "notifications.manage" | "audit.read" | "audit.manage" | "search.read"
  | "tenant.manage";

const ROLE_PERMISSIONS: Record<string, ReadonlySet<Permission> | "*"> = {
  administrateur: "*",
  superviseur: new Set<Permission>([
    "dashboard.read", "voyages.read", "voyages.manage", "bookings.create",
    "seats.read", "seats.manage", "payments.read", "payments.manage",
    "finance.read", "finance.manage", "fleet.read", "fleet.update", "fleet.manage", "personnel.read",
    "personnel.manage", "incidents.read", "incidents.report", "incidents.manage",
    "notifications.read", "notifications.manage", "audit.read", "search.read"
  ]),
  agent_acceuil: new Set<Permission>([
    "voyages.read", "bookings.create", "seats.read", "seats.manage", "search.read"
  ]),
  caissier: new Set<Permission>([
    "payments.read", "payments.manage"
  ]),
  conducteur: new Set<Permission>([
    "voyages.read", "seats.read", "incidents.read", "incidents.report", "notifications.read"
  ]),
  mécanicien: new Set<Permission>([
    "fleet.read", "fleet.update", "incidents.read"
  ])
};

export const hasPermission = (role: string, permission: Permission): boolean => {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions === "*" || Boolean(permissions?.has(permission));
};

export const authorizePermission = (permission: Permission) =>
  (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (
      !user ||
      !user.id ||
      !user.email ||
      !req.tenantId ||
      user.tenantId !== req.tenantId ||
      !hasPermission(user.role, permission)
    ) {
      return res.status(403).json({
        success: false,
        message: "Non autorisé - Permission insuffisante"
      });
    }
    return next();
  };
