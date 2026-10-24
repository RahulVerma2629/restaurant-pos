CREATE TABLE events (
	id INTEGER NOT NULL, 
	name VARCHAR(60) NOT NULL, 
	payload TEXT NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);

CREATE INDEX ix_events_name ON events (name);

CREATE TABLE menu_categories (
	id INTEGER NOT NULL, 
	branch_id INTEGER, 
	name VARCHAR(100) NOT NULL, 
	sort_order INTEGER NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE orders (
	id INTEGER NOT NULL, 
	order_no VARCHAR(40) NOT NULL, 
	branch_id INTEGER NOT NULL, 
	order_type VARCHAR(20) NOT NULL, 
	table_id INTEGER, 
	customer_id INTEGER, 
	customer_name VARCHAR(100), 
	customer_phone VARCHAR(30), 
	guests INTEGER, 
	source VARCHAR(20) NOT NULL, 
	status VARCHAR(30) NOT NULL, 
	prev_status VARCHAR(30), 
	payment_status VARCHAR(20) NOT NULL, 
	handed_over BOOLEAN NOT NULL, 
	note TEXT, 
	cancel_reason VARCHAR(300), 
	merged_into_order_id INTEGER, 
	request_id VARCHAR(100), 
	version INTEGER NOT NULL, 
	created_by VARCHAR(50) NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (branch_id, order_no), 
	UNIQUE (request_id)
);

CREATE INDEX ix_orders_status ON orders (status);

CREATE INDEX ix_orders_branch_id ON orders (branch_id);

CREATE TABLE table_merges (
	id INTEGER NOT NULL, 
	primary_table_id INTEGER NOT NULL, 
	secondary_table_id INTEGER NOT NULL, 
	primary_order_id INTEGER NOT NULL, 
	secondary_order_id INTEGER NOT NULL, 
	by_user VARCHAR(50) NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE table_transfers (
	id INTEGER NOT NULL, 
	order_id INTEGER NOT NULL, 
	from_table_id INTEGER NOT NULL, 
	to_table_id INTEGER NOT NULL, 
	by_user VARCHAR(50) NOT NULL, 
	reason VARCHAR(200), 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE tables (
	id INTEGER NOT NULL, 
	branch_id INTEGER NOT NULL, 
	number VARCHAR(20) NOT NULL, 
	floor VARCHAR(50) NOT NULL, 
	capacity INTEGER NOT NULL, 
	status VARCHAR(30) NOT NULL, 
	guests INTEGER, 
	current_order_id INTEGER, 
	block_reason VARCHAR(200), 
	version INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (branch_id, floor, number)
);

CREATE INDEX ix_tables_status ON tables (status);

CREATE INDEX ix_tables_branch_id ON tables (branch_id);

CREATE TABLE deliveries (
	id INTEGER NOT NULL, 
	order_id INTEGER NOT NULL, 
	platform VARCHAR(50), 
	address TEXT, 
	rider VARCHAR(100), 
	status VARCHAR(20) NOT NULL, 
	failure_reason VARCHAR(300), 
	assigned_at DATETIME, 
	dispatched_at DATETIME, 
	delivered_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (order_id), 
	FOREIGN KEY(order_id) REFERENCES orders (id)
);

CREATE TABLE kots (
	id INTEGER NOT NULL, 
	kot_no VARCHAR(20) NOT NULL, 
	order_id INTEGER NOT NULL, 
	branch_id INTEGER NOT NULL, 
	station VARCHAR(50) NOT NULL, 
	priority VARCHAR(10) NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	type VARCHAR(10) NOT NULL, 
	retry_count INTEGER NOT NULL, 
	reprint_count INTEGER NOT NULL, 
	device VARCHAR(30), 
	created_at DATETIME NOT NULL, 
	sent_at DATETIME, 
	accepted_at DATETIME, 
	ready_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(order_id) REFERENCES orders (id)
);

CREATE INDEX ix_kots_station ON kots (station);

CREATE INDEX ix_kots_order_id ON kots (order_id);

CREATE INDEX ix_kots_branch_id ON kots (branch_id);

CREATE INDEX ix_kots_status ON kots (status);

CREATE TABLE menu_items (
	id INTEGER NOT NULL, 
	category_id INTEGER, 
	name VARCHAR(150) NOT NULL, 
	description TEXT, 
	image_url VARCHAR(300), 
	price INTEGER NOT NULL, 
	tax_category_id INTEGER, 
	prep_time_min INTEGER NOT NULL, 
	station VARCHAR(50) NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	stock_available BOOLEAN NOT NULL, 
	temp_unavailable BOOLEAN NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(category_id) REFERENCES menu_categories (id)
);

CREATE TABLE order_status_history (
	id INTEGER NOT NULL, 
	order_id INTEGER NOT NULL, 
	old_status VARCHAR(30), 
	new_status VARCHAR(30) NOT NULL, 
	changed_by VARCHAR(50) NOT NULL, 
	reason VARCHAR(300), 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(order_id) REFERENCES orders (id)
);

CREATE INDEX ix_order_status_history_order_id ON order_status_history (order_id);

CREATE TABLE menu_item_branch (
	id INTEGER NOT NULL, 
	item_id INTEGER NOT NULL, 
	branch_id INTEGER NOT NULL, 
	price_override INTEGER, 
	is_available BOOLEAN NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (item_id, branch_id), 
	FOREIGN KEY(item_id) REFERENCES menu_items (id)
);

CREATE TABLE menu_time_slots (
	id INTEGER NOT NULL, 
	item_id INTEGER NOT NULL, 
	day_of_week INTEGER, 
	start TIME NOT NULL, 
	"end" TIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(item_id) REFERENCES menu_items (id)
);

CREATE TABLE modifier_groups (
	id INTEGER NOT NULL, 
	item_id INTEGER NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	min_select INTEGER NOT NULL, 
	max_select INTEGER NOT NULL, 
	required BOOLEAN NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(item_id) REFERENCES menu_items (id)
);

CREATE TABLE order_items (
	id INTEGER NOT NULL, 
	order_id INTEGER NOT NULL, 
	menu_item_id INTEGER NOT NULL, 
	name_snapshot VARCHAR(150) NOT NULL, 
	price_snapshot INTEGER NOT NULL, 
	qty INTEGER NOT NULL, 
	note VARCHAR(300), 
	status VARCHAR(20) NOT NULL, 
	kot_id INTEGER, 
	origin_table_id INTEGER, 
	cancel_reason VARCHAR(300), 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(order_id) REFERENCES orders (id), 
	FOREIGN KEY(menu_item_id) REFERENCES menu_items (id)
);

CREATE INDEX ix_order_items_order_id ON order_items (order_id);

CREATE TABLE kot_items (
	id INTEGER NOT NULL, 
	kot_id INTEGER NOT NULL, 
	order_item_id INTEGER NOT NULL, 
	name_snapshot VARCHAR(150) NOT NULL, 
	qty INTEGER NOT NULL, 
	note VARCHAR(300), 
	modifiers_text VARCHAR(300), 
	status VARCHAR(20) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(kot_id) REFERENCES kots (id), 
	FOREIGN KEY(order_item_id) REFERENCES order_items (id)
);

CREATE INDEX ix_kot_items_kot_id ON kot_items (kot_id);

CREATE TABLE modifiers (
	id INTEGER NOT NULL, 
	group_id INTEGER NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	extra_price INTEGER NOT NULL, 
	max_qty INTEGER NOT NULL, 
	is_available BOOLEAN NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(group_id) REFERENCES modifier_groups (id)
);

CREATE TABLE order_item_modifiers (
	id INTEGER NOT NULL, 
	order_item_id INTEGER NOT NULL, 
	modifier_id INTEGER NOT NULL, 
	name_snapshot VARCHAR(100) NOT NULL, 
	price_snapshot INTEGER NOT NULL, 
	qty INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(order_item_id) REFERENCES order_items (id)
);
