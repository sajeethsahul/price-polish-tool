import type { ActionFunctionArgs } from "react-router";
import ExcelJS from "exceljs";
import { authenticate } from "../shopify.server";
import { applyLocaleFromSession, t } from "../utils/i18n";

interface ExportRow {
  title: string;
  sku?: string | null;
  priceBefore: number;
  adjustment: number;
  rounding: number;
  newPrice: number;
  priceChange: number;
}

const money = (value: number, currency: string) =>
  `${currency} ${value.toFixed(2)}`;

const COLORS = {
  headerBg: "FF1A1A2E",
  headerFont: "FFFFFFFF",
  summaryBg: "FFF0F4FF",
  summaryFont: "FF1F2937",
  rowEven: "FFFFFFFF",
  rowOdd: "FFF9F9F9",
  positive: "FF16A34A",
  negative: "FFDC2626",
  zero: "FF6B7280",
  totalBg: "FFE8F5E9",
};

export async function action({ request }: ActionFunctionArgs) {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) return auth;

  if (!auth?.session) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const { session } = auth;
  const shop = session.shop;

  const body = (await request.json().catch(() => null)) as {
    campaignTitle?: string;
    currencyCode?: string;
    locale?: string;
    rows?: ExportRow[];
  } | null;

  // Locale: prefer the locale the UI is rendered in, fall back to session.
  applyLocaleFromSession(session, body?.locale);

  const rows = Array.isArray(body?.rows) ? body!.rows! : [];
  if (rows.length === 0) {
    return Response.json({ error: "No rows to export" }, { status: 400 });
  }

  const currency = (body?.currencyCode ?? "USD").trim() || "USD";
  const campaignTitle =
    (body?.campaignTitle ?? "").trim() || t("export.campaign");

  const productCount = new Set(rows.map((r) => r.title)).size;
  const variantCount = rows.length;
  const avgChange =
    rows.reduce(
      (sum, r) =>
        sum + (r.priceBefore !== 0 ? (r.priceChange / r.priceBefore) * 100 : 0),
      0,
    ) / rows.length;
  const avgChangeLabel = `${avgChange >= 0 ? "+" : ""}${avgChange.toFixed(2)}%`;

  const now = new Date();
  const generated = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Impact Report");
  sheet.columns = [
    { width: 35 }, // Product
    { width: 15 }, // SKU
    { width: 15 }, // Price Before
    { width: 15 }, // Adjustment
    { width: 12 }, // Rounding
    { width: 15 }, // New Price
    { width: 15 }, // Price Change
  ];

  const summaryFill = {
    type: "pattern" as const,
    pattern: "solid" as const,
    fgColor: { argb: COLORS.summaryBg },
  };

  // ── Summary section (rows 1–7), light blue background, bold labels ────────
  const summaryRows: Array<[string, string]> = [
    [t("export.reportTitle"), ""],
    [t("export.campaign"), campaignTitle],
    [t("export.generated"), generated],
    [t("export.downloadedBy"), shop],
    [t("export.productsAffected"), String(productCount)],
    [t("export.variantsAffected"), String(variantCount)],
    [t("export.averageChange"), avgChangeLabel],
  ];
  summaryRows.forEach(([label, value], index) => {
    const row = sheet.getRow(index + 1);
    const labelCell = row.getCell(1);
    const valueCell = row.getCell(2);
    labelCell.value = label;
    valueCell.value = value;
    labelCell.font = { bold: true, color: { argb: COLORS.summaryFont } };
    labelCell.fill = summaryFill;
    valueCell.fill = summaryFill;
  });

  // Row 8: empty spacer with bottom border
  const spacerRow = sheet.getRow(8);
  for (let col = 1; col <= 7; col++) {
    spacerRow.getCell(col).border = { bottom: { style: "thin" } };
  }

  // ── Header row (row 9): dark navy bg, white bold font, 20px height ────────
  const headers = [
    t("export.headers.product"),
    t("export.headers.sku"),
    t("export.headers.priceBefore"),
    t("export.headers.adjustment"),
    t("export.headers.rounding"),
    t("export.headers.newPrice"),
    t("export.headers.priceChange"),
  ];
  const headerRow = sheet.getRow(9);
  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: COLORS.headerFont } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.headerBg },
    };
  });
  headerRow.height = 20;

  // ── Data rows (row 10+): alternating fill, colored Price Change ───────────
  rows.forEach((r, index) => {
    const row = sheet.getRow(10 + index);
    const rowFill = {
      type: "pattern" as const,
      pattern: "solid" as const,
      fgColor: { argb: index % 2 === 0 ? COLORS.rowEven : COLORS.rowOdd },
    };
    const values: Array<string | number> = [
      r.title,
      r.sku ?? "",
      money(r.priceBefore, currency),
      money(r.adjustment, currency),
      money(r.rounding, currency),
      money(r.newPrice, currency),
      money(r.priceChange, currency),
    ];
    values.forEach((value, colIndex) => {
      const cell = row.getCell(colIndex + 1);
      cell.value = value;
      cell.fill = rowFill;
    });
    const changeCell = row.getCell(7);
    changeCell.font = {
      color: {
        argb:
          r.priceChange > 0
            ? COLORS.positive
            : r.priceChange < 0
              ? COLORS.negative
              : COLORS.zero,
      },
    };
  });

  // ── TOTAL row at the bottom: light green bg, bold ─────────────────────────
  const sumBefore = rows.reduce((sum, r) => sum + r.priceBefore, 0);
  const sumNew = rows.reduce((sum, r) => sum + r.newPrice, 0);
  const sumChange = rows.reduce((sum, r) => sum + r.priceChange, 0);
  const totalRow = sheet.getRow(10 + rows.length);
  const totalValues = [
    t("export.total"),
    "",
    money(sumBefore, currency),
    "",
    "",
    money(sumNew, currency),
    money(sumChange, currency),
  ];
  totalValues.forEach((value, index) => {
    const cell = totalRow.getCell(index + 1);
    cell.value = value;
    cell.font = { bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.totalBg },
    };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="impact-report.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
