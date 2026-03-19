# VULN: Runs as root, debug port exposed, JMX exposed
FROM maven:3.8.6-eclipse-temurin-11 AS build

# VULN: Running as root (no USER directive)
WORKDIR /app

# Copy pom first for dependency caching
COPY pom.xml .
RUN mvn dependency:go-offline -B 2>/dev/null || true

# Copy source and build
COPY src ./src
RUN mvn package -DskipTests -B

# Runtime stage - still vulnerable
FROM eclipse-temurin:11-jre

WORKDIR /app
COPY --from=build /app/target/*.jar app.jar

# VULN: Debug port 5005 exposed
# VULN: JMX port 9090 exposed without authentication
EXPOSE 8080 5005 9090

# VULN: Running with debug and JMX enabled
ENV JAVA_OPTS="-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005 \
    -Dcom.sun.management.jmxremote \
    -Dcom.sun.management.jmxremote.port=9090 \
    -Dcom.sun.management.jmxremote.rmi.port=9090 \
    -Dcom.sun.management.jmxremote.authenticate=false \
    -Dcom.sun.management.jmxremote.ssl=false \
    -Djava.rmi.server.hostname=0.0.0.0"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
