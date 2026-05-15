import { Injectable } from "@nestjs/common";
import braintree from "braintree";

type PassengerPayment = {
  passengerId: string;
  customerId: string;
  paymentMethodToken: string;
};
type DriverPayout = {
  driverId: string;
  accountHolder: string;
  payoutDestination: string;
};

@Injectable()
export class PaymentsService {
  private readonly paymentByPassenger = new Map<string, PassengerPayment>();
  private readonly payoutByDriver = new Map<string, DriverPayout>();
  private readonly gateway: braintree.BraintreeGateway | null;

  constructor() {
    const merchantId = process.env.BRAINTREE_MERCHANT_ID;
    const publicKey = process.env.BRAINTREE_PUBLIC_KEY;
    const privateKey = process.env.BRAINTREE_PRIVATE_KEY;
    if (!merchantId || !publicKey || !privateKey) {
      this.gateway = null;
      return;
    }
    this.gateway = new braintree.BraintreeGateway({
      environment:
        process.env.BRAINTREE_ENVIRONMENT === "production"
          ? braintree.Environment.Production
          : braintree.Environment.Sandbox,
      merchantId,
      publicKey,
      privateKey
    });
  }

  hasPaymentMethod(passengerId: string): boolean {
    return this.paymentByPassenger.has(passengerId);
  }

  hasDriverPayoutMethod(driverId: string): boolean {
    return this.payoutByDriver.has(driverId);
  }

  setupDriverPayoutMethod(payload: DriverPayout) {
    this.payoutByDriver.set(payload.driverId, payload);
    return { configured: true as const };
  }

  async setupPassengerPaymentMethod(payload: {
    passengerId: string;
    email?: string;
    paymentMethodNonce: string;
  }): Promise<{ configured: true; customerId: string; paymentMethodToken: string }> {
    if (!this.gateway) {
      const mock: PassengerPayment = {
        passengerId: payload.passengerId,
        customerId: `mock-customer-${payload.passengerId.slice(0, 8)}`,
        paymentMethodToken: payload.paymentMethodNonce
      };
      this.paymentByPassenger.set(payload.passengerId, mock);
      return { configured: true, customerId: mock.customerId, paymentMethodToken: mock.paymentMethodToken };
    }

    const customer = await this.gateway.customer.create({
      email: payload.email || undefined
    });
    const customerId = customer.success ? customer.customer.id : `nexo-${payload.passengerId}`;

    const pm = await this.gateway.paymentMethod.create({
      customerId,
      paymentMethodNonce: payload.paymentMethodNonce,
      options: { verifyCard: true }
    });
    if (!pm.success || !pm.paymentMethod?.token) {
      throw new Error("Could not store payment method.");
    }
    const stored: PassengerPayment = {
      passengerId: payload.passengerId,
      customerId,
      paymentMethodToken: pm.paymentMethod.token
    };
    this.paymentByPassenger.set(payload.passengerId, stored);
    return { configured: true, customerId, paymentMethodToken: stored.paymentMethodToken };
  }

  async chargePassengerForRide(payload: { passengerId: string; amount: number; rideId: string }) {
    const saved = this.paymentByPassenger.get(payload.passengerId);
    if (!saved) {
      return { ok: false as const, reason: "missing_payment_method" as const };
    }
    if (!this.gateway) {
      return { ok: true as const, transactionId: `mock-tx-${payload.rideId.slice(0, 8)}` };
    }
    const tx = await this.gateway.transaction.sale({
      amount: payload.amount.toFixed(2),
      paymentMethodToken: saved.paymentMethodToken,
      options: { submitForSettlement: true }
    });
    if (!tx.success || !tx.transaction?.id) {
      return { ok: false as const, reason: "charge_failed" as const };
    }
    return { ok: true as const, transactionId: tx.transaction.id };
  }

  async refundRideCharge(payload: { transactionId: string; rideId: string }) {
    if (!this.gateway) {
      return { ok: true as const, refundId: `mock-refund-${payload.rideId.slice(0, 8)}`, mode: "mock" as const };
    }

    const refund = await this.gateway.transaction.refund(payload.transactionId);
    if (refund.success && refund.transaction?.id) {
      return { ok: true as const, refundId: refund.transaction.id, mode: "refund" as const };
    }

    // Braintree can require `void` before settlement instead of `refund`.
    const voidResult = await this.gateway.transaction.void(payload.transactionId);
    if (voidResult.success && voidResult.transaction?.id) {
      return { ok: true as const, refundId: voidResult.transaction.id, mode: "void" as const };
    }

    return { ok: false as const, reason: "refund_failed" as const };
  }
}

