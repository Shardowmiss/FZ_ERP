import re, pathlib
ROOT=pathlib.Path("/Users/woxxnixx/WorkBuddy/2026-09-17-14-43-21/erp_source/client/src/pages")
candidates=[
 "sales/SalesOrderPage.tsx","sales/SalesOutboundPage.tsx","sales/SalesReturnPage.tsx",
 "purchase/PurchaseOrderPage.tsx","purchase/GarmentPurchaseOrderPage.tsx","purchase/PurchaseReturnPage.tsx","purchase/MaterialPurchaseOrderPage.tsx",
 "retail/RetailOrderPage.tsx","retail/RetailReturnPage.tsx",
 "inventory/InventoryInboundPage.tsx","inventory/InventoryOutboundPage.tsx","inventory/InventoryTransferPage.tsx","inventory/InventoryFlowPage.tsx","inventory/InventoryStocktakePage.tsx",
 "finance/ReceivablePage.tsx","finance/PayablePage.tsx","finance/ReceiptPage.tsx","finance/PaymentPage.tsx",
 "production/WorkOrderPage.tsx","production/MaterialIssuePage.tsx","production/FinishReceiptPage.tsx",
 "subcontract/SubcontractPage.tsx",
]
for rel in candidates:
    p=ROOT/rel
    if not p.exists():
        print(f"[MISSING] {rel}"); continue
    txt=p.read_text(encoding="utf-8")
    starts=set(re.findall(r'const\s+\[(startDate|filterStartDate|beginDate|formStartDate|start)\s*,\s*set\w+\]\s*=\s*useState', txt))
    ends=set(re.findall(r'const\s+\[(endDate|filterEndDate|endDate2|formEndDate|end)\s*,\s*set\w+\]\s*=\s*useState', txt))
    sends = bool(re.search(r'params\.(startDate|endDate|beginDate|endDate2)\s*=|if\s*\(\s*(startDate|filterStartDate|beginDate|endDate|filterEndDate)\s*\)\s*params', txt))
    empty_init = bool(re.search(r'useState\(\s*(null|\'\'|"")\s*\)', txt))
    if starts and ends and sends:
        flag="EDIT"
    elif starts and ends and not sends:
        flag="NO-SEND"
    else:
        flag="NO-FILTER"
    print(f"[{flag:9s}] {rel:42s} start={sorted(starts)} end={sorted(ends)} sends={sends} emptyInit={empty_init}")
