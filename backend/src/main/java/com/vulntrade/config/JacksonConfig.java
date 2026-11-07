package com.vulntrade.config;

import com.fasterxml.jackson.datatype.jsr310.ser.LocalDateTimeSerializer;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * Timestamps are stored and produced in UTC (TIMESTAMP columns, UTC JVM). Write them with an
 * explicit 'Z' so browsers don't read them as local time. Applies to REST and STOMP (Spring
 * Boot's WebSocket message converter uses this ObjectMapper).
 */
@Configuration
public class JacksonConfig {

    private static final DateTimeFormatter UTC_ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer utcLocalDateTime() {
        return builder -> builder.serializerByType(LocalDateTime.class, new LocalDateTimeSerializer(UTC_ISO));
    }
}
