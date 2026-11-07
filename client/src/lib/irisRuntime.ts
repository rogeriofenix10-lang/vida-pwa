// O Pages é uma publicação estática, mas a Iris continua conectada ao Worker
// gratuito. Em produção não dependemos de uma variável VITE ausente no Pages.
export const IRIS_STATIC_MODE =
  import.meta.env.PROD || import.meta.env.VITE_IRIS_STATIC === "true";
