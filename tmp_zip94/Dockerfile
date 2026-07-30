# hadolint ignore=DL3008
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY app.csproj ./
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
COPY --from=build /app/publish .
ENV PORT=8080
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
USER 1000
ENTRYPOINT ["dotnet", "app.dll"]
