jest.mock("@ubos/database", () => ({
  Prisma: {
    Decimal: jest.requireActual("@prisma/client/runtime/client").Decimal,
  },
  database: {
    payment: {
      findMany: jest.fn(),
    },
  },
}));

import { Reflector } from "@nestjs/core";
import { OperationsController } from "./operations.controller";
import type { ApiRequest } from "../common/http-context";

describe("OperationsController payment routes", () => {
  const reflector = new Reflector();

  it("requires payments.manage permission to list payments", () => {
    const metadata = reflector.getAllAndOverride("requiredPermissions", [
      OperationsController.prototype.payments,
    ]);
    expect(metadata).toEqual(["payments.manage"]);
  });

  it("requires payments.manage permission to create payments", () => {
    const metadata = reflector.getAllAndOverride("requiredPermissions", [
      OperationsController.prototype.createPayment,
    ]);
    expect(metadata).toEqual(["payments.manage"]);
  });
});

describe("OperationsController update targets", () => {
  it("uses the product route id instead of accepting an id from the body", () => {
    const operations = { updateProduct: jest.fn() };
    const controller = new OperationsController(operations as never, {} as never);
    const request = {
      organization: { id: "org-1" },
      user: { id: "user-1" },
    } as ApiRequest;
    controller.updateProduct("path-product", { name: "Renamed" }, request);
    expect(operations.updateProduct).toHaveBeenCalledWith(
      "path-product",
      { name: "Renamed" },
      request.organization,
      "user-1",
    );
  });

  it("uses route ids for customer and supplier updates", () => {
    const operations = {
      updateCustomer: jest.fn(),
      updateSupplier: jest.fn(),
    };
    const controller = new OperationsController(operations as never, {} as never);
    const request = {
      organization: { id: "org-1" },
      user: { id: "user-1" },
    } as ApiRequest;
    controller.updateCustomer("path-customer", { name: "Customer" }, request);
    controller.updateSupplier("path-supplier", { name: "Supplier" }, request);
    expect(operations.updateCustomer).toHaveBeenCalledWith(
      "path-customer",
      { name: "Customer" },
      request.organization,
      "user-1",
    );
    expect(operations.updateSupplier).toHaveBeenCalledWith(
      "path-supplier",
      { name: "Supplier" },
      request.organization,
      "user-1",
    );
  });
});
