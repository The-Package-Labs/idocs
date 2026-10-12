Every request enters here. The gateway checks the token, applies the rate limit and routes by path.

| Path | Goes to | Limit |
|---|---|---|
| `/orders/*` | orders | 120 / min |
| `/pay/*` | payments | 60 / min |

Authentication is delegated to Keycloak, over an edge that is **hidden** in the diagram: scenarios can still fly along it.
