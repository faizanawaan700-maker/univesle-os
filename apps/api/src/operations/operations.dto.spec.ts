import "reflect-metadata";

import { validate } from "class-validator";
import { UpdateCustomerDto, UpdateProductDto, UpdateSupplierDto } from "./operations.dto";

describe("operations DTOs — email validation", () => {
  const base = (dto: typeof UpdateCustomerDto) => {
    return new dto();
  };

  describe("UpdateCustomerDto.email", () => {
    it("passes a normal valid email", async () => {
      const dto = base(UpdateCustomerDto);
      dto.email = "customer@example.com";
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it("fails an invalid email", async () => {
      const dto = base(UpdateCustomerDto);
      dto.email = "not-an-email";
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("fails an email exceeding 320 characters", async () => {
      const dto = base(UpdateCustomerDto);
      dto.email = "a".repeat(321) + "@example.com";
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe("UpdateSupplierDto.email", () => {
    it("passes a normal valid email", async () => {
      const dto = base(UpdateSupplierDto);
      dto.email = "supplier@example.com";
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it("fails an invalid email", async () => {
      const dto = base(UpdateSupplierDto);
      dto.email = "not-an-email";
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("fails an email exceeding 320 characters", async () => {
      const dto = base(UpdateSupplierDto);
      dto.email = "a".repeat(321) + "@example.com";
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  it("allows explicit null for nullable product/contact fields", async () => {
    const product = new UpdateProductDto();
    product.sku = null;
    product.barcode = null;
    product.categoryId = null;
    const customer = new UpdateCustomerDto();
    customer.email = null;
    customer.phone = null;
    customer.notes = null;
    const supplier = new UpdateSupplierDto();
    supplier.email = null;
    supplier.phone = null;
    supplier.notes = null;

    await expect(validate(product)).resolves.toHaveLength(0);
    await expect(validate(customer)).resolves.toHaveLength(0);
    await expect(validate(supplier)).resolves.toHaveLength(0);
  });

  it("rejects null for non-nullable update fields", async () => {
    const product = new UpdateProductDto();
    product.name = null as never;
    const customer = new UpdateCustomerDto();
    customer.name = null as never;
    await expect(validate(product)).resolves.not.toHaveLength(0);
    await expect(validate(customer)).resolves.not.toHaveLength(0);
  });

  it("does not allow body ids in update DTOs", async () => {
    const dto = Object.assign(new UpdateProductDto(), { id: "body-selected" });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some((error) => error.property === "id")).toBe(true);
  });
});
