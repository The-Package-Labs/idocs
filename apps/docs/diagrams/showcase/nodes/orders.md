The order service owns the order from the moment it is created until it is paid, shipped or failed.

- Writes the order **before** the card is charged.
- Reserves stock for 15 minutes.
- Publishes `order.created` for everyone who needs to know.

Open the diagram inside it to see how it is built.
