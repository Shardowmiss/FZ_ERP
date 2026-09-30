-- POS missing-table build (filtered from drizzle-kit generate)
-- 27 missing pos_* tables; 10 existing tables untouched.
-- user_profile composite type already exists in pos_db.
-- Broken 'DEFAULT CASE ... THEN NULL' (no END) stripped -> column defaults to NULL.
-- Execute: PGPASSWORD=erp psql -h localhost -p 5434 -U erp -d pos_db -f scripts/pos-build-missing.sql

CREATE TABLE "pos_coupon" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"coupon_code" varchar(50) NOT NULL,
	"name" varchar(200) NOT NULL,
	"type" varchar(20) NOT NULL,
	"discount_value" bigint NOT NULL,
	"min_amount" bigint DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'available' NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"used_at" timestamptz(3),
	"used_order_no" varchar(100),
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" ,
	CONSTRAINT "pos_coupon_coupon_code_unique" UNIQUE("coupon_code")
);
--> statement-breakpoint
CREATE TABLE "pos_employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(50) NOT NULL,
	"deleted_at" timestamptz(3),
	"code" varchar(50) NOT NULL,
	"role" varchar(20) DEFAULT 'sales' NOT NULL,
	"store_id" varchar(50),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"password_hash" varchar(200),
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" ,
	CONSTRAINT "pos_employee_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "pos_eod" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eod_no" varchar(50) NOT NULL,
	"store_id" varchar(50) NOT NULL,
	"eod_date" date NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"total_sales" bigint DEFAULT 0 NOT NULL,
	"total_refund" bigint DEFAULT 0 NOT NULL,
	"total_discount" bigint DEFAULT 0 NOT NULL,
	"net_sales" bigint DEFAULT 0 NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"customer_count" integer DEFAULT 0 NOT NULL,
	"avg_ticket" bigint DEFAULT 0 NOT NULL,
	"attach_rate" numeric DEFAULT '0' NOT NULL,
	"member_sale_ratio" numeric DEFAULT '0' NOT NULL,
	"closed_at" timestamptz(3),
	"synced_to_erp" boolean DEFAULT false NOT NULL,
	"sync_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" ,
	CONSTRAINT "pos_eod_eod_no_unique" UNIQUE("eod_no")
);
--> statement-breakpoint
CREATE TABLE "pos_eod_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eod_id" uuid NOT NULL,
	"pay_method" varchar(20) NOT NULL,
	"sale_amount" bigint DEFAULT 0 NOT NULL,
	"refund_amount" bigint DEFAULT 0 NOT NULL,
	"net_amount" bigint DEFAULT 0 NOT NULL,
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" 
);
--> statement-breakpoint
CREATE TABLE "pos_offline_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" varchar(50) NOT NULL,
	"client_id" varchar(100) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_data" jsonb NOT NULL,
	"sync_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"server_entity_id" varchar(64),
	"synced_at" timestamptz(3),
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" ,
	CONSTRAINT "pos_offline_queue_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "pos_omnichannel_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sku_id" varchar(100) NOT NULL,
	"style_id" varchar(50) NOT NULL,
	"style_name" varchar(200) NOT NULL,
	"color_id" varchar(10) NOT NULL,
	"size_id" varchar(10) NOT NULL,
	"qty" integer NOT NULL,
	"price" bigint NOT NULL,
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" 
);
--> statement-breakpoint
CREATE TABLE "pos_omnichannel_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_no" varchar(50) NOT NULL,
	"channel" varchar(30) NOT NULL,
	"type" varchar(20) NOT NULL,
	"store_id" varchar(50) NOT NULL,
	"member_name" varchar(100),
	"member_phone" varchar(20),
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"address" text,
	"pickup_code" varchar(20),
	"picked_at" timestamptz(3),
	"shipped_at" timestamptz(3),
	"source_no" varchar(50),
	"sale_order_no" varchar(50),
	"fulfilled_at" timestamptz(3),
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" ,
	CONSTRAINT "pos_omnichannel_order_order_no_unique" UNIQUE("order_no")
);
--> statement-breakpoint
CREATE TABLE "pos_operation_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" varchar(50),
	"employee_id" uuid,
	"module" varchar(50) NOT NULL,
	"action" varchar(50) NOT NULL,
	"target_no" varchar(100),
	"content" text,
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" 
);
--> statement-breakpoint
CREATE TABLE "pos_points_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"change" integer NOT NULL,
	"balance" integer NOT NULL,
	"type" varchar(20) NOT NULL,
	"source_no" varchar(100),
	"remark" varchar(200),
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" 
);
--> statement-breakpoint
CREATE TABLE "pos_preorder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preorder_no" varchar(50) NOT NULL,
	"store_id" varchar(50) NOT NULL,
	"member_id" uuid,
	"employee_id" uuid,
	"total_qty" integer DEFAULT 0 NOT NULL,
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"delivery_type" varchar(20) DEFAULT 'mail' NOT NULL,
	"address" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"synced_to_erp" boolean DEFAULT false NOT NULL,
	"sync_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" ,
	CONSTRAINT "pos_preorder_preorder_no_unique" UNIQUE("preorder_no")
);
--> statement-breakpoint
CREATE TABLE "pos_preorder_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preorder_id" uuid NOT NULL,
	"sku_id" varchar(100) NOT NULL,
	"style_id" varchar(50) NOT NULL,
	"style_name" varchar(200) NOT NULL,
	"color_id" varchar(10) NOT NULL,
	"size_id" varchar(10) NOT NULL,
	"qty" integer NOT NULL,
	"price" bigint NOT NULL,
	"from_location" varchar(100),
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" 
);
--> statement-breakpoint
CREATE TABLE "pos_return_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"original_item_id" uuid NOT NULL,
	"sku_id" varchar(100) NOT NULL,
	"style_id" varchar(50) NOT NULL,
	"style_name" varchar(200) NOT NULL,
	"color_id" varchar(10) NOT NULL,
	"size_id" varchar(10) NOT NULL,
	"qty" integer NOT NULL,
	"refund_price" bigint NOT NULL,
	"line_amount" bigint NOT NULL,
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" 
);
--> statement-breakpoint
CREATE TABLE "pos_return_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_no" varchar(50) NOT NULL,
	"original_order_no" varchar(50) NOT NULL,
	"store_id" varchar(50) NOT NULL,
	"member_id" uuid,
	"employee_id" uuid,
	"total_qty" integer DEFAULT 0 NOT NULL,
	"refund_amount" bigint DEFAULT 0 NOT NULL,
	"refund_method" varchar(20) DEFAULT 'original' NOT NULL,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"shift_id" uuid,
	"remark" varchar(500),
	"synced_to_erp" boolean DEFAULT false NOT NULL,
	"sync_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"sync_at" timestamptz(3),
	"client_id" varchar(100),
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" ,
	CONSTRAINT "pos_return_order_return_no_unique" UNIQUE("return_no"),
	CONSTRAINT "pos_return_order_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "pos_sale_discount" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"promotion_id" uuid,
	"name" varchar(200) NOT NULL,
	"type" varchar(30) NOT NULL,
	"amount" bigint NOT NULL,
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" 
);
--> statement-breakpoint
CREATE TABLE "pos_sale_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sku_id" varchar(100) NOT NULL,
	"style_id" varchar(50) NOT NULL,
	"style_name" varchar(200) NOT NULL,
	"color_id" varchar(10) NOT NULL,
	"size_id" varchar(10) NOT NULL,
	"qty" integer NOT NULL,
	"tag_price" bigint NOT NULL,
	"unit_price" bigint NOT NULL,
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"line_amount" bigint NOT NULL,
	"refunded_qty" integer DEFAULT 0 NOT NULL,
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" 
);
--> statement-breakpoint
CREATE TABLE "pos_sale_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_no" varchar(50) NOT NULL,
	"store_id" varchar(50) NOT NULL,
	"member_id" uuid,
	"employee_id" uuid,
	"sale_date" date DEFAULT CURRENT_DATE NOT NULL,
	"total_qty" integer DEFAULT 0 NOT NULL,
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"pay_amount" bigint DEFAULT 0 NOT NULL,
	"points_used" integer DEFAULT 0 NOT NULL,
	"points_earned" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"channel" varchar(20) DEFAULT 'store' NOT NULL,
	"shift_id" uuid,
	"remark" varchar(500),
	"synced_to_erp" boolean DEFAULT false NOT NULL,
	"sync_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"sync_at" timestamptz(3),
	"client_id" varchar(100),
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" ,
	CONSTRAINT "pos_sale_order_order_no_unique" UNIQUE("order_no"),
	CONSTRAINT "pos_sale_order_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "pos_sale_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"pay_method" varchar(20) NOT NULL,
	"amount" bigint NOT NULL,
	"change_amount" bigint DEFAULT 0 NOT NULL,
	"transaction_id" varchar(100),
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" 
);
--> statement-breakpoint
CREATE TABLE "pos_shift" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_no" varchar(50) NOT NULL,
	"store_id" varchar(50) NOT NULL,
	"cashier_id" uuid,
	"start_time" timestamptz(3) NOT NULL,
	"end_time" timestamptz(3),
	"opening_cash" bigint DEFAULT 0 NOT NULL,
	"closing_cash" bigint,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"sale_count" integer DEFAULT 0 NOT NULL,
	"sale_amount" bigint DEFAULT 0 NOT NULL,
	"refund_amount" bigint DEFAULT 0 NOT NULL,
	"cash_expected" bigint,
	"cash_actual" bigint,
	"cash_diff" bigint,
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" ,
	CONSTRAINT "pos_shift_shift_no_unique" UNIQUE("shift_no")
);
--> statement-breakpoint
CREATE TABLE "pos_stock_adjust" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adjust_no" varchar(50) NOT NULL,
	"store_id" varchar(50) NOT NULL,
	"type" varchar(20) NOT NULL,
	"reason" varchar(500),
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"employee_id" uuid,
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" ,
	CONSTRAINT "pos_stock_adjust_adjust_no_unique" UNIQUE("adjust_no")
);
--> statement-breakpoint
CREATE TABLE "pos_stock_adjust_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adjust_id" uuid NOT NULL,
	"sku_id" varchar(100) NOT NULL,
	"style_id" varchar(50) NOT NULL,
	"color_id" varchar(10) NOT NULL,
	"size_id" varchar(10) NOT NULL,
	"qty" integer NOT NULL,
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" 
);
--> statement-breakpoint
CREATE TABLE "pos_stocktake" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stocktake_no" varchar(50) NOT NULL,
	"store_id" varchar(50) NOT NULL,
	"type" varchar(20) DEFAULT 'full' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"total_qty" integer DEFAULT 0 NOT NULL,
	"diff_qty" integer DEFAULT 0 NOT NULL,
	"employee_id" uuid,
	"audited_at" timestamptz(3),
	"synced_to_erp" boolean DEFAULT false NOT NULL,
	"sync_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"sync_at" timestamptz(3),
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" ,
	CONSTRAINT "pos_stocktake_stocktake_no_unique" UNIQUE("stocktake_no")
);
--> statement-breakpoint
CREATE TABLE "pos_stocktake_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stocktake_id" uuid NOT NULL,
	"sku_id" varchar(100) NOT NULL,
	"style_id" varchar(50) NOT NULL,
	"color_id" varchar(10) NOT NULL,
	"size_id" varchar(10) NOT NULL,
	"book_qty" integer DEFAULT 0 NOT NULL,
	"actual_qty" integer DEFAULT 0 NOT NULL,
	"diff_qty" integer DEFAULT 0 NOT NULL,
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" 
);
--> statement-breakpoint
CREATE TABLE "pos_store" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(50) NOT NULL,
	"address" varchar(500),
	"deleted_at" timestamptz(3),
	"phone" varchar(50),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" ,
	CONSTRAINT "pos_store_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "pos_stored_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"change" bigint NOT NULL,
	"balance" bigint NOT NULL,
	"type" varchar(20) NOT NULL,
	"source_no" varchar(100),
	"remark" varchar(200),
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" 
);
--> statement-breakpoint
CREATE TABLE "pos_suspended_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" varchar(50) NOT NULL,
	"member_id" uuid,
	"employee_id" uuid,
	"items" jsonb NOT NULL,
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"client_id" varchar(100),
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" ,
	CONSTRAINT "pos_suspended_order_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "pos_transfer_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"req_no" varchar(50) NOT NULL,
	"store_id" varchar(50) NOT NULL,
	"employee_id" uuid,
	"total_qty" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'submitted' NOT NULL,
	"remark" varchar(500),
	"synced_to_erp" boolean DEFAULT false NOT NULL,
	"sync_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"sync_at" timestamptz(3),
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" ,
	CONSTRAINT "pos_transfer_request_req_no_unique" UNIQUE("req_no")
);
--> statement-breakpoint
CREATE TABLE "pos_transfer_request_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"req_id" uuid NOT NULL,
	"sku_id" varchar(100) NOT NULL,
	"style_id" varchar(50) NOT NULL,
	"color_id" varchar(10) NOT NULL,
	"size_id" varchar(10) NOT NULL,
	"req_qty" integer NOT NULL,
	"_created_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_created_by" "user_profile" ,
	"_updated_at" timestamptz(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"_updated_by" "user_profile" 
);
--> statement-breakpoint
ALTER TABLE "pos_coupon" ADD CONSTRAINT "pos_coupon_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."pos_member"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_eod_payment" ADD CONSTRAINT "pos_eod_payment_eod_id_fkey" FOREIGN KEY ("eod_id") REFERENCES "public"."pos_eod"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_omnichannel_item" ADD CONSTRAINT "pos_omnichannel_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."pos_omnichannel_order"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_points_log" ADD CONSTRAINT "pos_points_log_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."pos_member"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_preorder" ADD CONSTRAINT "pos_preorder_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."pos_employee"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_preorder" ADD CONSTRAINT "pos_preorder_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."pos_member"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_preorder_item" ADD CONSTRAINT "pos_preorder_item_preorder_id_fkey" FOREIGN KEY ("preorder_id") REFERENCES "public"."pos_preorder"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_return_item" ADD CONSTRAINT "pos_return_item_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "public"."pos_return_order"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_return_order" ADD CONSTRAINT "pos_return_order_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."pos_employee"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_return_order" ADD CONSTRAINT "pos_return_order_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."pos_member"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_sale_discount" ADD CONSTRAINT "pos_sale_discount_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."pos_sale_order"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_sale_item" ADD CONSTRAINT "pos_sale_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."pos_sale_order"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_sale_order" ADD CONSTRAINT "pos_sale_order_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."pos_employee"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_sale_order" ADD CONSTRAINT "pos_sale_order_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."pos_member"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_sale_payment" ADD CONSTRAINT "pos_sale_payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."pos_sale_order"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_shift" ADD CONSTRAINT "pos_shift_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "public"."pos_employee"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_adjust" ADD CONSTRAINT "pos_stock_adjust_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."pos_employee"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stock_adjust_item" ADD CONSTRAINT "pos_stock_adjust_item_adjust_id_fkey" FOREIGN KEY ("adjust_id") REFERENCES "public"."pos_stock_adjust"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stocktake" ADD CONSTRAINT "pos_stocktake_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."pos_employee"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stocktake_item" ADD CONSTRAINT "pos_stocktake_item_stocktake_id_fkey" FOREIGN KEY ("stocktake_id") REFERENCES "public"."pos_stocktake"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_stored_log" ADD CONSTRAINT "pos_stored_log_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."pos_member"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_transfer_request" ADD CONSTRAINT "pos_transfer_request_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."pos_employee"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_transfer_request_item" ADD CONSTRAINT "pos_transfer_request_item_req_id_fkey" FOREIGN KEY ("req_id") REFERENCES "public"."pos_transfer_request"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_coupon_coupon_code_key" ON "pos_coupon" USING btree ("coupon_code");
--> statement-breakpoint
CREATE INDEX "idx_pos_coupon_member" ON "pos_coupon" USING btree ("member_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_employee_code_key" ON "pos_employee" USING btree ("code");
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_eod_eod_no_key" ON "pos_eod" USING btree ("eod_no");
--> statement-breakpoint
CREATE INDEX "idx_pos_eod_store" ON "pos_eod" USING btree ("store_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_pos_eod_date" ON "pos_eod" USING btree ("store_id","eod_date");
--> statement-breakpoint
CREATE INDEX "idx_pos_eod_pay_eod" ON "pos_eod_payment" USING btree ("eod_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_offline_queue_client_id_key" ON "pos_offline_queue" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX "idx_offline_queue_store" ON "pos_offline_queue" USING btree ("store_id");
--> statement-breakpoint
CREATE INDEX "idx_offline_queue_status" ON "pos_offline_queue" USING btree ("sync_status");
--> statement-breakpoint
CREATE INDEX "idx_offline_queue_entity" ON "pos_offline_queue" USING btree ("entity_type");
--> statement-breakpoint
CREATE INDEX "idx_pos_omni_item_order" ON "pos_omnichannel_item" USING btree ("order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_omnichannel_order_order_no_key" ON "pos_omnichannel_order" USING btree ("order_no");
--> statement-breakpoint
CREATE INDEX "idx_pos_omni_store" ON "pos_omnichannel_order" USING btree ("store_id");
--> statement-breakpoint
CREATE INDEX "idx_pos_omni_status" ON "pos_omnichannel_order" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "idx_pos_omni_sale" ON "pos_omnichannel_order" USING btree ("sale_order_no");
--> statement-breakpoint
CREATE INDEX "idx_pos_oplog_time" ON "pos_operation_log" USING btree ("_created_at");
--> statement-breakpoint
CREATE INDEX "idx_pos_points_member" ON "pos_points_log" USING btree ("member_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_preorder_preorder_no_key" ON "pos_preorder" USING btree ("preorder_no");
--> statement-breakpoint
CREATE INDEX "idx_pos_preorder_item_pid" ON "pos_preorder_item" USING btree ("preorder_id");
--> statement-breakpoint
CREATE INDEX "idx_pos_return_item_return" ON "pos_return_item" USING btree ("return_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_return_order_return_no_key" ON "pos_return_order" USING btree ("return_no");
--> statement-breakpoint
CREATE INDEX "idx_pos_return_store" ON "pos_return_order" USING btree ("store_id");
--> statement-breakpoint
CREATE INDEX "idx_pos_return_original" ON "pos_return_order" USING btree ("original_order_no");
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_return_order_client" ON "pos_return_order" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX "idx_pos_sale_disc_order" ON "pos_sale_discount" USING btree ("order_id");
--> statement-breakpoint
CREATE INDEX "idx_pos_sale_item_order" ON "pos_sale_item" USING btree ("order_id");
--> statement-breakpoint
CREATE INDEX "idx_pos_sale_item_sku" ON "pos_sale_item" USING btree ("sku_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_sale_order_order_no_key" ON "pos_sale_order" USING btree ("order_no");
--> statement-breakpoint
CREATE INDEX "idx_pos_sale_store" ON "pos_sale_order" USING btree ("store_id");
--> statement-breakpoint
CREATE INDEX "idx_pos_sale_member" ON "pos_sale_order" USING btree ("member_id");
--> statement-breakpoint
CREATE INDEX "idx_pos_sale_created" ON "pos_sale_order" USING btree ("_created_at");
--> statement-breakpoint
CREATE INDEX "idx_pos_sale_sync" ON "pos_sale_order" USING btree ("sync_status");
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sale_order_client" ON "pos_sale_order" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX "idx_pos_sale_pay_order" ON "pos_sale_payment" USING btree ("order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_shift_shift_no_key" ON "pos_shift" USING btree ("shift_no");
--> statement-breakpoint
CREATE INDEX "idx_pos_shift_store" ON "pos_shift" USING btree ("store_id");
--> statement-breakpoint
CREATE INDEX "idx_pos_shift_status" ON "pos_shift" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_stock_adjust_adjust_no_key" ON "pos_stock_adjust" USING btree ("adjust_no");
--> statement-breakpoint
CREATE INDEX "idx_pos_stock_adj_item_adjust_id" ON "pos_stock_adjust_item" USING btree ("adjust_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_stocktake_stocktake_no_key" ON "pos_stocktake" USING btree ("stocktake_no");
--> statement-breakpoint
CREATE INDEX "idx_pos_stocktake_store" ON "pos_stocktake" USING btree ("store_id");
--> statement-breakpoint
CREATE INDEX "idx_pos_st_item_stid" ON "pos_stocktake_item" USING btree ("stocktake_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_store_code_key" ON "pos_store" USING btree ("code");
--> statement-breakpoint
CREATE INDEX "idx_pos_stored_member" ON "pos_stored_log" USING btree ("member_id");
--> statement-breakpoint
CREATE INDEX "idx_pos_suspended_store_status" ON "pos_suspended_order" USING btree ("store_id","status","_created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_transfer_request_req_no_key" ON "pos_transfer_request" USING btree ("req_no");
--> statement-breakpoint
CREATE INDEX "idx_pos_treq_store" ON "pos_transfer_request" USING btree ("store_id");
--> statement-breakpoint
CREATE INDEX "idx_pos_treq_item_rid" ON "pos_transfer_request_item" USING btree ("req_id");;
